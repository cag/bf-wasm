const path = require("path");
const fs = require("fs");

const wasmBuffer = fs.readFileSync(path.join(__dirname, "bf.wasm"));
const wasmModule = new WebAssembly.Module(wasmBuffer);

wasmEnvImports = {};

[
  '__syscall0', '__syscall1', '__syscall2', '__syscall3',
  '__syscall4', '__syscall5', '__syscall6',
  '__addtf3', '__subtf3', '__multf3',
  '__unordtf2', '__eqtf2', '__netf2',
  '__fixunstfsi', '__floatunsitf',
  '__fixtfsi', '__floatsitf', '__extenddftf2',
].forEach((call) => {
  wasmEnvImports[call] = {[call]() {
    throw new Error(`${call} not implemented yet`)
  }}[call];
});

const wasmInstance = new WebAssembly.Instance(wasmModule, { env: wasmEnvImports });

module.exports = wasmInstance;
