const path = require("path");
const fs = require("fs");

const wasmBuffer = fs.readFileSync(path.join(__dirname, "bf.wasm"));
const wasmModule = new WebAssembly.Module(wasmBuffer);

wasmEnvImports = {};

[
  "__syscall0",
  "__syscall1",
  "__syscall2",
  "__syscall3",
  "__syscall4",
  "__syscall5",
  "__syscall6",
  "__addtf3",
  "__subtf3",
  "__multf3",
  "__unordtf2",
  "__eqtf2",
  "__netf2",
  "__fixunstfsi",
  "__floatunsitf",
  "__fixtfsi",
  "__floatsitf",
  "__extenddftf2"
].forEach(call => {
  wasmEnvImports[call] = {
    [call]() {
      throw new Error(
        `${call} not implemented yet -- got args ${Array.from(arguments)}`
      );
    }
  }[call];
});

let heapLimit;
wasmEnvImports.sbrk = function sbrk(inc) {
  heapLimit = Math.max(heapLimit + inc, heapBase);
  const curMemSize = wasmInstance.exports.memory.buffer.byteLength;
  const bytesPerPage = 64 * 1024;
  if (heapLimit >= curMemSize) {
    wasmInstance.exports.memory.grow(
      Math.ceil((heapLimit + 1 - curMemSize) / bytesPerPage)
    );
    if (heapLimit >= wasmInstance.exports.memory.buffer.byteLength) {
      throw new Error(
        `could not grow memory ${
          wasmInstance.exports.memory
        } to accommodate address ${heapLimit}`
      );
    }
  }
  return heapLimit;
};

const wasmInstance = new WebAssembly.Instance(wasmModule, {
  env: wasmEnvImports
});
const heapBase = (heapLimit = wasmInstance.exports.__heap_base.value);
const memUtils = require("./mem-utils")(
  wasmInstance.exports.memory,
  wasmInstance.exports.malloc
);

module.exports = require("./bf")(wasmInstance, memUtils);
