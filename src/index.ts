import {promisify} from 'util';
import resolve from 'resolve';
import * as sass from 'sass';
import {dirname} from 'path';
import * as fs from 'fs';
import {createFilter} from '@rollup/pluginutils';
import {insertStyle} from './style';
import {
  RollupAssetInfo,
  RollupChunkInfo,
  RollupPluginSassOptions,
  RollupPluginSassOutputFn,
  SassOptions
} from "./types";
import {error, isFunction, isObject, isString, warn} from "./utils";

// @note Rollup is added as a "devDependency" so no actual symbols should be imported.
//  Interfaces and non-concrete types are ok.
import {Plugin as RollupPlugin} from 'rollup';

const MATCH_SASS_FILENAME_RE = /\.sass$/,

  MATCH_NODE_MODULE_RE = /^~([a-z0-9]|@).+/i,

  insertFnName = '___$insertStyle',

  /**
   * Returns a sass `importer` list:
   * @see https://sass-lang.com/documentation/js-api#importer
   */
  getImporterList = (sassOptions: SassOptions) => {
    const importer1 = (url, importer, done) => {
      if (!MATCH_NODE_MODULE_RE.test(url)) {
        return null;
      }

      const moduleUrl = url.slice(1);
      const resolveOptions = {
        basedir: dirname(importer),
        extensions: ['.scss', '.sass'],
      };

      promisify(resolve)(moduleUrl, resolveOptions)
        .then(file => done({file}))
        .catch(err => {
          warn('[rollup-plugin-sass]: Recovered from error: ', err);
          // If importer has sibling importers then exit and allow one of the other
          //  importers to attempt file path resolution.
          if (sassOptions.importer && sassOptions.importer.length > 1) {
            done(null);
            return;
          }
          done({
            file: url,
          });
        })

        // Catch any further errors
        .catch(err => {
          error(err); // Log error
          done(new Error(err));
        });
    }
    return [importer1].concat(sassOptions.importer || [])
  },

  processRenderResponse = (rollupOptions, file, state, inCss) => {
    if (!inCss) return;

    const {processor} = rollupOptions;

    return Promise.resolve()
      .then(() => !isFunction(processor) ? inCss + '' : processor(inCss, file))
      .then(result => {
        if (!isObject(result)) {
          return [result, ''];
        }
        if (!isString(result.css)) {
          throw new Error('You need to return the styles using the `css` property. ' +
            'See https://github.com/differui/rollup-plugin-sass#processor');
        }
        const outCss = result.css;
        const restExports = Object.keys(result).reduce((agg, name) =>
            name === 'css' ? agg : agg + `export const ${name} = ${JSON.stringify(result[name])};\n`
          , ''
        );
        return [outCss, restExports];
      })
      .then(([resolvedCss, restExports]) => {
        const {styleMaps} = state;

        // Update bundle tracking entry with resolved content
        styleMaps[file].content = resolvedCss;

        const out = JSON.stringify(resolvedCss);

        let defaultExport = `""`;

        if (rollupOptions.insert) {
          defaultExport = `${insertFnName}(${out});`;
        } else if (!rollupOptions.output) {
          defaultExport = out;
        }

        return `export default ${defaultExport};\n${restExports}`;
      }); // @note do not `catch` here - let error propagate to rollup level
  },

  defaultIncludes = ['**/*.sass', '**/*.scss'],

  defaultExcludes = 'node_modules/**';

// Typescript syntax for CommonJs "default exports" compatible export
// @reference https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require
export = function plugin(options = {} as RollupPluginSassOptions): RollupPlugin {
  const pluginOptions = Object.assign({
      runtime: sass,
      output: false,
      insert: false
    }, options),

    {
      include = defaultIncludes,
      exclude = defaultExcludes,
      runtime: sassRuntime,
      options: incomingSassOptions = {}
    } = pluginOptions,

    filter = createFilter(include || '', exclude || ''),

    pluginState = {
      // Stores interim bundle objects
      styles: [] as {id?: string, content?: string}[],

      // "";  Used, currently to ensure that we're not pushing style objects representing
      // the same file-path into `pluginState.styles` more than once.
      styleMaps: {} as {[index: string]: {id?: string, content?: string}}
    };

  return {
    name: 'rollup-plugin-sass',

    intro() {
      if (pluginOptions.insert) {
        return insertStyle.toString().replace(/insertStyle/, insertFnName);
      }
    },

    transform(code: string, filePath: string): Promise<any> {
      if (!filter(filePath)) {
        return Promise.resolve();
      }
      const paths = [dirname(filePath), process.cwd()],

       {styleMaps, styles} = pluginState,

        resolvedOptions = Object.assign({}, incomingSassOptions, {
          file: filePath,
          data: incomingSassOptions.data && `${incomingSassOptions.data}${code}`,
          indentedSyntax: MATCH_SASS_FILENAME_RE.test(filePath),
          includePaths: (incomingSassOptions.includePaths || []).concat(paths),
          importer: getImporterList(incomingSassOptions),
        });

      // Setup resolved css output bundle tracking, for use later in `generateBundle` method.
      // ----
      if (!styleMaps[filePath]) {
        const mapEntry = {
          id: filePath,
          content: '', // Populated after `sass.render`
        };
        styleMaps[filePath] = mapEntry;
        styles.push(mapEntry);
      }

      return promisify(sassRuntime.render.bind(sassRuntime))(resolvedOptions)
        .then(res => processRenderResponse(pluginOptions, filePath, pluginState, res.css.toString().trim())
          .then(result => [res, result])
        )
        .then(([res, codeResult]) => ({
          code: codeResult,
          map: {mappings: res.map ? res.map.toString() : ''},
        })); // @note do not `catch` here - let error propagate to rollup level.
    },

    generateBundle(generateOptions: { file?: string },
                   bundle: { [fileName: string]: RollupAssetInfo | RollupChunkInfo },
                   isWrite: boolean
    ): Promise<any> {
      if (!isWrite || (!pluginOptions.insert && (!pluginState.styles.length || pluginOptions.output === false))) {
        return Promise.resolve();
      }

      const {styles} = pluginState,
        css = styles.map(style => style.content).join(''),
        {output, insert} = pluginOptions;

      if (typeof output === 'string') {
        return fs.promises.mkdir(dirname(output as string), {recursive: true})
          .then(() => fs.promises.writeFile(output as string, css));
      } else if (typeof output === 'function') {
        return Promise.resolve((output as RollupPluginSassOutputFn)(css, styles));
      } else if (!insert && generateOptions.file && output === true) {
        let dest = generateOptions.file;

        if (dest.endsWith('.js') || dest.endsWith('.ts')) {
          dest = dest.slice(0, -3);
        }
        dest = `${dest}.css`;
        return fs.promises.mkdir(dirname(dest), {recursive: true})
          .then(() => fs.promises.writeFile(dest, css));
      }

      return Promise.resolve(css);
    },
  } as RollupPlugin;
}
