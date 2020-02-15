const path = require("path");
const fs = require("fs");

const { importCost, cleanup, JAVASCRIPT } = require("import-cost");

let verbose = false;

function generateImports(library, methods) {
  if (methods.length === 0) {
    return `import "${library}";`;
  }
  if (methods.indexOf("*") !== -1) {
    return `import * as _everything_ from "${library}";`;
  }
  const hasDefault = methods.indexOf("default") !== -1;
  const namedImports = methods.filter(m => m !== "*" && m !== "default");
  let res = `import `;
  if (hasDefault) {
    res += `_default_`;
    if (namedImports.length) res += `,`;
  }
  namedImports.forEach(i => {
    if (!/^[\w_$][\w\d_$]*?$/.test(i)) {
      throw new Error(`Invalid import: '${i}'`);
    }
  });
  if (namedImports.length > 0) {
    res += ` {${namedImports.join(",")}} `;
  }
  res += `from '${library}';`;
  if (verbose) {
    console.log("Analyzing: " + res);
  }
  return res;
}

async function analyze(dir, library, methods) {
  let resolve, reject;

  const p = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  const target = path.join(dir, "import-size.js");
  const emitter = importCost(
    target,
    generateImports(library, methods),
    JAVASCRIPT
  );

  emitter.on("error", e => {
    stop();
    reject(e);
  });
  emitter.on("done", packages => {
    stop();
    if (packages.length === 0) {
      return reject("No packages found");
    }
    if (packages.length > 1) {
      console.warn("Multiple packages found");
    }
    console.log(packages[0].gzip);
    resolve();
  });

  function stop() {
    emitter.removeAllListeners();
    cleanup();
  }

  return p;
}

function determineImportName(lib) {
  let targetPath = "";
  if (lib === ".") {
    targetPath = process.cwd();
  } else if (lib.startsWith("/")) {
    targetPath = lib;
  } else if (lib.startsWith(".")) {
    targetPath = path.resolve(process.cwd(), lib);
  } else {
    // not a file path but imported module
    return [lib, []];
  }
  if (!fs.existsSync(path.join(targetPath, "package.json"))) {
    throw new Error("Failed to find a package at " + targetPath);
  }
  const toRemove = [];
  const modulesDir = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir);
    toRemove.push(modulesDir);
  }
  const linkLok = path.join(modulesDir, "__importsizelink__");
  if (fs.existsSync(linkLok)) {
    fs.unlinkSync(linkLok);
  }
  if (verbose) {
    console.log(`linking ${linkLok} to ${targetPath}`);
  }
  fs.symlinkSync(targetPath, linkLok);
  toRemove.unshift(linkLok);
  return ["__importsizelink__", toRemove];
}

function main() {
  const program = require("commander")
    .name(require("./package.json").name)
    .version(require("./package.json").version)
    .usage("[options] library [...imports]")
    .description(
      `Computes the production build, tree-shaken costs of your imports.\nFor example, to compute the build size impact if you import only 'observable' and 'autorun' from 'mobx':\n\n      import-size mobx autorun observable\n\n. Or, to compute the size of everything:\n\n      import-size mobx '*'`
    )
    .option("--verbose", "show some debug output", false)
    .parse(process.argv);

  if (program.args.length < 1) {
    program.outputHelp();
    process.exit(1);
  }

  verbose = program.verbose;

  const [library, ...methods] = program.args;
  const [importName, toRemove] = determineImportName(library);

  function cleanFiles() {
    toRemove.forEach(f => fs.unlinkSync(f));
  }

  analyze(process.cwd(), importName, methods).then(
    () => {
      cleanFiles();
      process.exit(0);
    },
    e => {
      console.error(e);
      cleanFiles();
      process.exit(1);
    }
  );
}

main();

module.exports = { analyze };
