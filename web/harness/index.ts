// The registry of fixtures: W0's shared ones, and one directory per lane. Never in a
// production build: nothing imports it but harness/main.tsx.
import type { Fixtures } from "./fixture";
import { fixtures as draft } from "./draft";
import { fixtures as files } from "./files";
import { fixtures as gesture } from "./gesture";
import { fixtures as home } from "./home";
import { fixtures as pwa } from "./pwa";
import { fixtures as shared } from "./shared";
import { fixtures as terminal } from "./terminal";

export const fixtures: Fixtures = { ...shared, ...home, ...terminal, ...files, ...pwa, ...draft, ...gesture };
