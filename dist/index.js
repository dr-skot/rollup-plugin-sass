"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("util");
const resolve_1 = __importDefault(require("resolve"));
const sass_1 = __importDefault(require("sass"));
const path_1 = require("path");
const fs = __importStar(require("fs"));
const rollup_pluginutils_1 = require("rollup-pluginutils");
const style_1 = require("./style");
const utils_1 = require("./utils");
const MATCH_SASS_FILENAME_RE = /\.sass$/, MATCH_NODE_MODULE_RE = /^~([a-z0-9]|@).+/i, insertFnName = '___$insertStyle', getImporterList = sassOptions => {
    const importer1 = (url, importer, done) => {
        if (!MATCH_NODE_MODULE_RE.test(url)) {
            return null;
        }
        const moduleUrl = url.slice(1);
        const resolveOptions = {
            basedir: path_1.dirname(importer),
            extensions: ['.scss', '.sass'],
        };
        try {
            done({
                file: resolve_1.default.sync(moduleUrl, resolveOptions),
            });
        }
        catch (err) {
            utils_1.warn('default sass importer recovered from an error: ', err);
            if (sassOptions.importer && sassOptions.importer.length > 1) {
                return null;
            }
            done({
                file: url,
            });
        }
    };
    return [importer1].concat(sassOptions.importer || []);
}, processRenderResponse = (rollupOptions, file, state, inCss) => {
    if (!inCss)
        return;
    const { processor } = rollupOptions;
    return Promise.resolve()
        .then(() => !utils_1.isFunction(processor) ? inCss + '' : processor(inCss, file))
        .then(result => {
        if (!utils_1.isObject(result)) {
            return [result, ''];
        }
        if (!utils_1.isString(result.css)) {
            throw new Error('You need to return the styles using the `css` property. ' +
                'See https://github.com/differui/rollup-plugin-sass#processor');
        }
        const outCss = result.css;
        const restExports = Object.keys(result).reduce((agg, name) => name === 'css' ? agg : agg + `export const ${name} = ${JSON.stringify(result[name])};\n`, '');
        return [outCss, restExports];
    })
        .then(([resolvedCss, restExports]) => {
        const { styleMaps, styles } = state;
        if (styleMaps[file]) {
            styleMaps[file].content = resolvedCss;
        }
        else {
            const mapEntry = {
                id: file,
                content: resolvedCss,
            };
            styleMaps[file] = mapEntry;
            styles.push(mapEntry);
        }
        const out = JSON.stringify(resolvedCss);
        let defaultExport = `""`;
        if (rollupOptions.insert) {
            defaultExport = `${insertFnName}(${out});`;
        }
        else if (!rollupOptions.output) {
            defaultExport = out;
        }
        return `export default ${defaultExport};\n${restExports}`;
    });
};
function plugin(options = {}) {
    const pluginOptions = Object.assign({
        runtime: sass_1.default,
        include: ['**/*.sass', '**/*.scss'],
        exclude: 'node_modules/**',
        output: false,
        insert: false
    }, options), { include, exclude, runtime: sassRuntime, options: incomingSassOptions = {} } = pluginOptions, filter = rollup_pluginutils_1.createFilter(include, exclude), styles = [], styleMaps = {};
    return {
        name: 'rollup-plugin-sass',
        intro() {
            if (pluginOptions.insert) {
                return style_1.insertStyle.toString().replace(/insertStyle/, insertFnName);
            }
        },
        transform(code, file) {
            if (!filter(file)) {
                return Promise.resolve();
            }
            const paths = [path_1.dirname(file), process.cwd()], resolvedOptions = Object.assign({}, incomingSassOptions, {
                file,
                data: incomingSassOptions.data && `${incomingSassOptions.data}${code}`,
                indentedSyntax: MATCH_SASS_FILENAME_RE.test(file),
                includePaths: (incomingSassOptions.includePaths || []).concat(paths),
                importer: getImporterList(incomingSassOptions),
            });
            return util_1.promisify(sassRuntime.render.bind(sassRuntime))(resolvedOptions)
                .then(res => processRenderResponse(pluginOptions, file, { styleMaps, styles }, res.css.toString().trim())
                .then(result => [res, result]))
                .then(([res, codeResult]) => ({
                code: codeResult,
                map: { mappings: res.map ? res.map.toString() : '' },
            }));
        },
        generateBundle(generateOptions, bundle, isWrite) {
            if (!isWrite || (!pluginOptions.insert && (!styles.length || pluginOptions.output === false))) {
                return Promise.resolve();
            }
            const css = styles.map(style => style.content).join(''), { output, insert } = pluginOptions;
            if (typeof output === 'string') {
                return fs.promises.mkdir(path_1.dirname(output), { recursive: true })
                    .then(() => fs.promises.writeFile(output, css));
            }
            else if (typeof output === 'function') {
                return Promise.resolve(output(css, styles));
            }
            else if (!insert && generateOptions.file && output === true) {
                let dest = generateOptions.file;
                if (dest.endsWith('.js') || dest.endsWith('.ts')) {
                    dest = dest.slice(0, -3);
                }
                dest = `${dest}.css`;
                return fs.promises.mkdir(path_1.dirname(dest), { recursive: true })
                    .then(() => fs.promises.writeFile(dest, css));
            }
            return Promise.resolve(css);
        },
    };
}
exports.default = plugin;
//# sourceMappingURL=index.js.map