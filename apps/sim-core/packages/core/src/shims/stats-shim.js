// Shim for drei's `import * as StatsImpl from 'three/examples/js/libs/stats.min'`
// drei does `new StatsImpl()` which requires the namespace to be callable.
// We re-export stats.js default as a callable module.
import Stats from "stats.js";
export default Stats;
// Make `import * as StatsImpl` work: Vite will make this the default
// because the module only has a default export.
