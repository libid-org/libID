import assert from 'node:assert/strict';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import specMarkdown from './src/spec-markdown.mjs';

const processor = await createMarkdownProcessor({ remarkPlugins: [specMarkdown] });
const source = `# Spec title

## Section

[Overview](libid.md#protocol-parameters)
[Rules][rules]
[External](https://example.com/file.md)

[rules]: ./ceremony-common.md#2-terminology
`;
const { code } = await processor.render(source, { fileURL: new URL('file:///repo/specs/example.md') });
assert.doesNotMatch(code, /<h1/);
assert.match(code, /<h2/);
assert.match(code, /href="\/specs\/#protocol-parameters"/);
assert.match(code, /href="\/specs\/ceremony-common\/#2-terminology"/);
assert.match(code, /href="https:\/\/example.com\/file.md"/);
const docs = await processor.render(source, { fileURL: new URL('file:///repo/docs/example.md') });
assert.match(docs.code, /<h1/);
assert.match(docs.code, /href="libid.md#protocol-parameters"/);
console.log('Spec Markdown checks passed.');
