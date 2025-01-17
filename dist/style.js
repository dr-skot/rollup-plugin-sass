"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertStyle = void 0;
function insertStyle(css) {
    if (!css || !window) {
        return;
    }
    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.innerHTML = css;
    document.head.appendChild(style);
    return css;
}
exports.insertStyle = insertStyle;
//# sourceMappingURL=style.js.map