#!/usr/bin/env node

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
  // or, run: "yarn webpack --mode production -p --display-optimizatin-bailout --entry ./test.js --context `pwd` && stat -f\"%z\" dist/null.js"
  return new Promise((resolve, reject) => {
    const target = path.join(dir, `import-size.js`);
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
      resolve(packages[0].gzip);
    });

    function stop() {
      emitter.removeAllListeners();
      cleanup();
    }
  });
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
    return [lib, [], lib];
  }
  if (!fs.existsSync(path.join(targetPath, "package.json"))) {
    throw new Error("Failed to find a package at " + targetPath);
  }
  const realname = JSON.parse(fs.readFileSync(path.join(targetPath, "package.json"), "utf8")).name
  const toRemove = [];
  const modulesDir = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir);
    toRemove.push(modulesDir);
  }
  const linkname = `__importsizelink${Math.random()}__`
  const linkLok = path.join(modulesDir, linkname);
  if (fs.existsSync(linkLok)) {
    fs.unlinkSync(linkLok);
  }
  if (verbose) {
    console.log(`linking ${linkLok} to ${targetPath}`);
  }
  fs.symlinkSync(targetPath, linkLok);
  toRemove.unshift(linkLok);
  return [linkname, toRemove, realname];
}

function main() {
  const program = require("commander")
    .name(require("./package.json").name)
    .version(require("./package.json").version)
    .usage("[options] library [...imports]")
    .description(
      `Computes the production build, tree-shaken costs of your imports.\nFor example, to compute the build size impact if you import only 'observable' and 'autorun' from 'mobx':\n\n      import-size mobx autorun observable\n\n. Or, to compute the size of everything:\n\n      import-size mobx '*'`
    )
    .option(
      "--report",
      "run an extensive report, displaying the individual sizes of the imports",
      false
    )
    .option("--verbose", "show some debug output", false)
    .parse(process.argv);

  if (program.args.length < 1) {
    program.outputHelp();
    process.exit(1);
  }

  verbose = program.verbose;

  const [library, ...methods] = program.args;
  const [importName, toRemove, realname] = determineImportName(library);

  function cleanFiles() {
    toRemove.forEach(f => fs.unlinkSync(f));
  }

  const p = program.report
    ? runReport(process.cwd(), importName, methods, realname)
    : analyze(process.cwd(), importName, methods).then(r => {
        console.log(r);
      });
  p.then(
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

async function runReport(dir, importName, methods, realname) {
  function progress(p) {
    console.log(`Creating build ${p + 2}/${methods.length * 2 + 1}`);
  }
  const results = {};
  results[`import * from '${realname}'`] = {
    "just this": await analyze(dir, importName, ["*"]),
    cumulative: 0,
    increment: 0
  };
  let prev;
  for (let i = 0; i < methods.length; i++) {
    progress(i * 2);
    const current = (results[methods[i]] = {
      "just this": await analyze(dir, importName, [methods[i]]),
      cumulative:
        (progress(i * 2 + 1),
        await analyze(dir, importName, methods.slice(0, i + 1))),
      increment: 0
    });
    if (i > 0) {
      current.increment = current.cumulative - prev.cumulative;
    }
    prev = current;
  }

  console.log('\n\nImport size report for ' + realname + ':')
  console.table(results);
  console.log('(this report was generated by npmjs.com/package/import-size)\n\n')
}

main();

module.exports = { analyze };
