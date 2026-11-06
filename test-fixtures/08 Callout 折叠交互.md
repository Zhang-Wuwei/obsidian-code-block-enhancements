# 08 Callout 折叠交互

将光标放在本段，再用完整鼠标按下／松开／点击操作箭头和省略号。Callout 应始终保持渲染，选区不变，源码不变。

> [!note]+ 折叠交互
>
> ```js
> function displayOnly(value) {
>   if (value) {
>     return value + 1;
>   }
>   return 0;
> }
> ```

正文保护标记。原生 Callout 标题的折叠仍应可用，正文／代码内容的普通编辑交互不应被插件全局阻止。
