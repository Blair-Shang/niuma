import{$ as e,Mt as t,Ot as n,Pt as r,bt as i,ct as a,ht as o,jt as s,mt as c,ot as l,pt as u,st as d,wt as f,xt as p,yt as m}from"./index-CrA0rARC.js";import{n as h,t as g}from"./DemoPage-Nwrrnwug.js";var _={class:`row`},v=`// main.ts — 顺序：先公共，后业务
import '@ruoshui/ui/styles.css'
import './theme/brand.css'

// theme/brand.css
[data-rs-theme='light'] {
  --rs-primary: #6366f1;
  --rs-primary-hover: #4f46e5;
}
[data-rs-theme='dark'] {
  --rs-primary: #818cf8;
  --rs-primary-hover: #a5b4fc;
}

// App.vue — JS 只负责切换明暗
<RsConfigProvider theme="dark">
  <App />
</RsConfigProvider>`,y=d(p({__name:`ThemePage`,setup(d){let{theme:p,locale:y,t:b}=a(),x=s(!1),S=u(()=>x.value?`品牌紫（CSS 覆盖）`:`公共 preset（国际 SaaS）`);function C(){x.value=!x.value,x.value?document.documentElement.setAttribute(`data-rs-brand`,`indigo`):document.documentElement.removeAttribute(`data-rs-brand`)}return(a,s)=>(f(),o(g,{title:`主题 / 多语言`,"test-file":`RsConfigProvider`},{default:n(()=>[i(h,{title:`当前配置`},{default:n(()=>[c(`p`,null,[s[0]||=m(`主题：`,-1),i(t(l),{variant:`primary`},{default:n(()=>[m(r(t(p)),1)]),_:1})]),c(`p`,null,[s[1]||=m(`色板：`,-1),i(t(l),{variant:`info`},{default:n(()=>[m(r(S.value),1)]),_:1})]),c(`p`,null,[s[2]||=m(`语言：`,-1),i(t(l),null,{default:n(()=>[m(r(t(y)),1)]),_:1})]),c(`p`,null,`文案示例 select.placeholder：`+r(t(b)(`select.placeholder`)),1)]),_:1}),i(h,{title:`CSS 覆盖公共主题`},{default:n(()=>[s[5]||=c(`p`,{class:`text`},[m(` 色值定义在 `),c(`code`,null,`styles.css`),m(`；业务在`),c(`strong`,null,`之后`),m(`加载自己的 CSS， 重写 `),c(`code`,null,`--rs-*`),m(` 即可。JS 的 `),c(`code`,null,`setTheme`),m(` 只切换 `),c(`code`,null,`data-rs-theme`),m(`。 `)],-1),c(`div`,_,[i(t(e),{onClick:C},{default:n(()=>[m(r(x.value?`恢复公共 preset`:`切换为品牌紫`),1)]),_:1}),i(t(e),{variant:`default`},{default:n(()=>[...s[3]||=[m(`default 按钮`,-1)]]),_:1}),i(t(e),{variant:`ghost`},{default:n(()=>[...s[4]||=[m(`ghost 按钮`,-1)]]),_:1})])]),_:1}),i(h,{title:`接入方式`},{default:n(()=>[c(`pre`,{class:`code-block`},r(v))]),_:1})]),_:1}))}}),[[`__scopeId`,`data-v-f4fe6a31`]]);export{y as default};