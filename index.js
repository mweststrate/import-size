const path = require("path");
const arg = require("arg");

const {importCost, cleanup, JAVASCRIPT} = require("import-cost");

async function analyze(dir, library, methods) {
  let resolve, reject;

  const p = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  })
  const emitter = importCost(path.join(dir, "import-size.js", `import {${methods.join(",")}} from '${library}'`), JAVASCRIPT /* or TYPESCRIPT */);
    emitter.on('error', (e)=> {
      stop()
      reject(e)
    });
    emitter.on('start', packages => {
      console.log('start', JSON.stringify(packages, null, 2));
    });
    emitter.on('calculated', package => {
      console.log('calculated', JSON.stringify(package, null, 2));
    });
    emitter.on('done', packages => {
      console.log('done', JSON.stringify(packages, null, 2));
      stop();
      resolve();
    });
    
  function stop() {
    emitter.removeAllListeners(); 
    cleanup();
  }

  return p;
}

function main() {
  const args = arg({
    '--help': Boolean,
    '--version': Boolean
  })

  if (args["--version"]) {
    console.log(require('./package.json').version);
    process.exit(0)
  }
  if (args["--help"]) {
    console.log("Usage: import-size [library] [...methods]\nExample: import-size mobx autorun observable");
    process.exit(0);
  }

  if (args._.length < 2) {
    console.error("requires at least two arguments")
    process.exit(1)
  }

  const[library, ...methods] = args._;
  analyze(process.cwd(), library, methods).then(() => {
    process.exit(0)
  }, e => {
    console.error(e);
    process.exit(1)
  });
}

main();
