import type { ComponentChildren } from "preact";
import type { TestPlatform, TestPlatformOptions } from "../platform/test";

/**
 * One named state of the app on the test platform. A lane adds fixtures in its own
 * `harness/<lane>/index.ts`; `harness/index.ts` gathers them. Open one with
 * `/harness/index.html?fixture=<name>` (plus `layout`, `scheme`, `density`).
 */
export interface Fixture {
  /** What the platform boots with: a saved workspace, hosts, a PWA capability. */
  options?: () => TestPlatformOptions;
  /** Edit the fake daemon before the app boots. */
  daemon?: (daemon: TestPlatform["daemon"]) => void;
  /** Open the saved workspace's active tab at launch, as a tap on its Home row would: a clean launch otherwise opens Home. */
  openActive?: true;
  /** Render this component instead of the app, inside the app's context. */
  render?: () => ComponentChildren;
}

export type Fixtures = Record<string, Fixture>;
