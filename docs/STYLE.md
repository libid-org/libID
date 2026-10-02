# Docs style

Write like the ENS docs from 2020
([example](https://github.com/ensdomains/docs/blob/a1c62320c96877fd70da60be7b5c65f4dda38f9b/dapp-developer-guide/resolving-names.md)):
plain words, short sentences, and code early.

- Start with the task. "Resolving a name is the most common thing you will do."
- Show the code, then explain it in a sentence or two.
- One idea per paragraph. Most paragraphs are one to three sentences.
- Say "you". Use the active voice.
- Use everyday words: "use", not "leverage"; "simple", not "seamless".
- No stacked qualifiers, no chains of dashes, no bold in running text.
- Name the function, event or error exactly, in backticks.
- Link to the spec for the full rules instead of restating them.
- Leave out history. Say how things work now.

Example:

> Resolving a name to an Ethereum address using a library is simple:
>
> ```js
> const address = await provider.resolveName('alice.eth');
> ```
