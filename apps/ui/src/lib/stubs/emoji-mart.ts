// Empty stub for `emoji-mart` and `@emoji-mart/data`.
//
// @blocknote/react's FloatingThreadController (Comments feature) dynamic-imports
// these libs. Our BlockEditor config does not enable comments/threadStore, so
// the controller never mounts at runtime, but Vite still emits the ~700 KB of
// emoji JSON into dist. Aliasing both packages to this file drops the chunks
// without runtime effect. If comments/threads ever get wired into BlockEditor,
// remove the alias from vite.config.ts.
//
// See AEQI idea feedback/blocknote-emoji-mart-dead-chunk and quest ae-021.

const empty = {} as Record<string, never>;
export default empty;
