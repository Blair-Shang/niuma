/**
 * Vite optimizeDeps 扫描入口：在 dev server 启动时预构建全部 CodeMirror 语言包，
 * 避免辅助窗口动态 import 命中过期 hash 导致 504 (Outdated Optimize Dep)。
 */
import 'codemirror'
import '@codemirror/lang-cpp'
import '@codemirror/lang-css'
import '@codemirror/lang-go'
import '@codemirror/lang-html'
import '@codemirror/lang-java'
import '@codemirror/lang-javascript'
import '@codemirror/lang-json'
import '@codemirror/lang-markdown'
import '@codemirror/lang-python'
import '@codemirror/lang-rust'
import '@codemirror/lang-sql'
import '@codemirror/lang-xml'
import '@codemirror/lang-yaml'
import '@codemirror/language'
import '@codemirror/legacy-modes/mode/shell'
