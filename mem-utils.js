const assert = require("assert");
const { LRUMap } = require("lru_map");

const utf8Encoder = new TextEncoder("utf-8");
const utf8Decoder = new TextDecoder("utf-8");

module.exports = function(memory, malloc, opts) {
  opts = opts || {}
  const wordSize = opts.wordSize || 4;
  const registerSize = opts.registerSize || 16;
  const numRegisters = opts.numRegisters || 8;
  
  const memViews = {
    int8: new Int8Array(memory.buffer),
    uint8: new Uint8Array(memory.buffer),
    uint8Clamped: new Uint8ClampedArray(memory.buffer),
    int16: new Int16Array(memory.buffer),
    uint16: new Uint16Array(memory.buffer),
    int32: new Int32Array(memory.buffer),
    uint32: new Uint32Array(memory.buffer),
    float32: new Float32Array(memory.buffer),
    float64: new Float64Array(memory.buffer)
  };

  memViews.word = memViews[`uint${wordSize * 8}`];
  memViews.sword = memViews[`int${wordSize * 8}`];
  const wordLimit = Math.pow(2, wordSize * 8);
  const [WordArray, SwordArray] = wordSize === 1 ? [Uint8Array, Int8Array] : wordSize === 2 ? [Uint16Array, Int16Array] : wordSize === 4 ? [Uint32Array, Int32Array] : []

  const registersBeginPtr = malloc(registerSize * numRegisters);
  const initRegister = Symbol("initRegister");
  const clearRegister = Symbol("clearRegister");
  const registersObjMap = new LRUMap(numRegisters);
  registersObjMap.assign([...Array(numRegisters).keys()].map(n => [n, null]));
  registersObjMap.shift = function shift() {
    const [n, obj] = LRUMap.prototype.shift.call(this);
    if (obj != null) {
      obj[clearRegister](getRegisterPtr(n));
      objsRegisterNumMap.delete(obj);
    }
    return [n, obj];
  };

  const objsRegisterNumMap = new WeakMap();

  function getRegisterPtr(n) {
    assert(
      Number.isInteger(n) && n >= 0 && n < numRegisters,
      `invalid register number ${n}`
    );
    return registersBeginPtr + n * registerSize;
  }

  function ensureRegister(obj) {
    let registerPtr;
    if (objsRegisterNumMap.has(obj)) {
      n = objsRegisterNumMap.get(obj);
      assert(
        registersObjMap.get(n) === obj,
        `wrong object found in register ${n}`
      );
      registerPtr = getRegisterPtr(n);
    } else {
      n = registersObjMap.shift()[0];
      registerPtr = getRegisterPtr(n);

      registersObjMap.set(n, obj);
      objsRegisterNumMap.set(obj, n);

      obj[initRegister](registerPtr);
    }
    return registerPtr;
  }

  return {
    registerSize,
    numRegisters,
    WordArray, SwordArray,
    isWord(n) {
      return Number.isInteger(n) && n >= 0 && n < wordLimit;
    },

    isSword(n) {
      return Number.isInteger(n) && n * 2 >= -wordLimit && n * 2 < wordLimit;
    },

    ensureRegister,
    initRegister,
    clearRegister,
    registerSize,
    memViews,

    stringToNewCStr(str) {
      const b = utf8Encoder.encode(str);
      const ptr = malloc(b.length + 1);
      memViews.uint8.set(b, ptr);
      memViews.uint8[ptr + b.length] = 0;
      return ptr;
    },
    cstrToString(ptr, length) {
      if(length == null)
        for (length = 0; memViews.uint8[ptr + length] !== 0; ++length);
      return utf8Decoder.decode(new DataView(memory.buffer, ptr, length));
    }
  };
};
