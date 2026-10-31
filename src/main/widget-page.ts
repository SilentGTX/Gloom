// The page an inline widget (show_widget) runs in: Claude's SVG or HTML inside
// a small frame of Gloom's own, with the colours of Gloom's window as CSS
// variables, a sendPrompt() that hands text to Gloom's composer, and its height
// reported so the frame fits it. Served from gloom-widget:// (protocol.ts).

export interface WidgetTheme {
  dark: boolean
  /** Gloom's accent, #rrggbb. */
  accent: string
}

const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!)

/** The widget's whole page. */
export function widgetPage(code: string, title: string, theme: WidgetTheme): string {
  const accent = /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : '#8860ea'
  const vars = theme.dark
    ? `--text:#ececf1;--muted:#a3a3ad;--surface:#26262b;--border:rgb(255 255 255 / 0.14);--accent:${accent};--background:transparent`
    : `--text:#1d1d22;--muted:#5f5f69;--surface:#f4f4f6;--border:rgb(0 0 0 / 0.12);--accent:${accent};--background:transparent`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(title)}</title>
<style>
:root{${vars};color-scheme:${theme.dark ? 'dark' : 'light'};font:13px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
html,body{margin:0;padding:0;background:transparent;color:var(--text)}
body{overflow:hidden}
svg{max-width:100%;height:auto}
</style>
<script>
(() => {
  // Text for Gloom's composer, as if you typed it; you send it.
  window.sendPrompt = (text) => parent.postMessage({ gloomWidget: 'prompt', text: String(text).slice(0, 20000) }, '*')
  const report = () => parent.postMessage({ gloomWidget: 'size', height: Math.ceil(document.documentElement.scrollHeight) }, '*')
  addEventListener('load', report)
  new ResizeObserver(report).observe(document.documentElement)
})()
</script>
</head>
<body>
${code}
</body>
</html>`
}
