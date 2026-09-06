// Bundle entry for the webview runtime. esbuild turns this into media/runtime.js
// so the preview no longer depends on the user's workspace having Pixi and Spine.
import * as pixi from 'pixi.js';
// Webview CSP forbids eval, which Pixi uses to generate shader sync code.
// This module swaps in eval-free polyfills at import time.
import 'pixi.js/unsafe-eval';
import {
  AtlasAttachmentLoader,
  SkeletonJson,
  Spine,
  SpineTexture,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';

export { pixi, AtlasAttachmentLoader, SkeletonJson, Spine, SpineTexture, TextureAtlas };
