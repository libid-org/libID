// Keep repository Markdown links and headings usable on the published spec pages.
export default function specMarkdown() {
  return (tree, file) => {
    if (!file.path?.includes('/specs/')) return;
    if (tree.children[0]?.type === 'heading' && tree.children[0].depth === 1) {
      tree.children.shift();
    }
    function rewrite(node) {
      if (node.type === 'link' || node.type === 'definition') {
        const match = /^(?:\.\/)?([^/#?]+)\.md(#.*)?$/.exec(node.url);
        if (match) {
          node.url = `/specs/${match[1] === 'libid' ? '' : `${match[1]}/`}${match[2] || ''}`;
        }
      }
      node.children?.forEach(rewrite);
    }
    rewrite(tree);
  };
}
