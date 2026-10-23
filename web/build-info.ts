// What this build of the page is (the build script replaces the four names, scripts/build-web.ts).
declare const __VERSION__: string;
declare const __CHANNEL__: 'release' | 'next' | 'pr';
declare const __PR__: string;
declare const __COMMIT__: string;

export const VERSION = __VERSION__;
export const CHANNEL = __CHANNEL__;
export const PR = __PR__;
export const COMMIT = __COMMIT__;

/** The way up from this page to the root of the site: the release at /, main at /next/, a preview at /pr/N/. */
export const UP = CHANNEL === 'pr' ? '../../' : CHANNEL === 'next' ? '../' : '';
