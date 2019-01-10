const { camelize } = require("humps");

function ctz32(x) {
  x |= x << 16;
  x |= x << 8;
  x |= x << 4;
  x |= x << 2;
  x |= x << 1;

  return 32 - Math.clz32(~x);
}

module.exports = function(wasmInstance, memUtils) {
  const wasmFns = wasmInstance.exports;
  const { memViews, ensureRegister, WordArray } = memUtils;
  const wordSize = memViews.word.BYTES_PER_ELEMENT;
  const doubleSize = memViews.float64.BYTES_PER_ELEMENT;

  const readFromMemory = Symbol("readFromMemory");
  const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

  function normalizeOptionsObject(opts, mode) {
    if (opts == null) opts = {};

    if (opts.radix == null) opts.radix = 0;

    if (
      !Number.isInteger(opts.radix) ||
      (opts.radix !== 0 && (opts.radix < 2 || opts.radix > 36))
    )
      throw new Error(`got invalid radix ${opts.radix}`);

    if (opts.prec == null) opts.prec = bf.defaultPrecision;

    if (
      !Number.isInteger(opts.prec) ||
      ((opts.prec < bf.precMin || opts.prec > bf.precMax) &&
        opts.prec !== bf.precInf)
    )
      throw new Error(`got invalid prec ${opts.prec}`);

    if (opts.roundingMode == null) opts.roundingMode = bf.defaultRoundingMode;

    if (
      typeof opts.roundingMode === "string" &&
      bf.roundingModes.hasOwnProperty(opts.roundingMode)
    )
      opts.roundingMode = bf.roundingModes[opts.roundingMode];
    else if (
      !(typeof opts.roundingMode === "number") ||
      !bf.roundingModeNames.hasOwnProperty(opts.roundingMode)
    )
      throw new Error(`got invalid rounding mode ${opts.roundingMode}`);

    opts.allowSubnormal =
      opts.allowSubnormal == null
        ? bf.defaultAllowSubnormal
        : Boolean(opts.allowSubnormal);

    if (opts.expnBits == null) opts.expnBits = bf.defaultExpnBits;

    if (
      !Number.isInteger(opts.expnBits) ||
      opts.expnBits < bf.expnBitsMin ||
      opts.expnBits > bf.expnBitsMax
    )
      throw new Error(`got invalid expn bits ${opts.expnBits}`);

    opts.flags =
      opts.roundingMode |
      (opts.allowSubnormal ? bf.flagAllowSubnormal : 0) |
      ((bf.expnBitsMax - opts.expnBits) << bf.flagExpnBitsShift);

    if (mode === "parse") {
      for (const optName of [
        "noHex",
        "binOct",
        "intOnly",
        "noPrefixAfterSign",
        "jsQuirks",
        "intPrecInf"
      ])
        if (opts[optName]) opts.flags |= bf.parseFlags[optName];
    } else if (mode === "toString") {
      if (opts.format == null) opts.format = bf.defaultToStringFormat;

      if (
        typeof opts.format === "string" &&
        bf.toStringFlags.formats.hasOwnProperty(opts.format)
      )
        opts.format = bf.toStringFlags.formats[opts.format];
      else if (
        !(typeof opts.format === "number") ||
        !bf.toStringFlags.formatNames.hasOwnProperty(opts.format)
      )
        throw new Error(`got invalid toString format ${opts.format}`);

      opts.flags |= opts.format;

      for (const optName of ["forceExp", "addPrefix", "jsQuirks"])
        if (opts[optName]) opts.flags |= bf.toStringFlags[optName];
    }

    return opts;
  }

  class BigFloat {
    constructor(initialValue, opts) {
      this.sign = 0;
      this.expn = 0;
      this.tab = null;
      const ptr = ensureRegister(this);

      if (initialValue != null) {
        if (bf.isBigFloat(initialValue)) {
          const otherPtr = ensureRegister(initialValue);
          wasmFns.bf_set(ptr, otherPtr);
        } else if (typeof initialValue === "number") {
          wasmFns.bf_set_float64(ptr, initialValue);
        } else if (typeof initialValue.toString === "function") {
          const strPtr = memUtils.stringToNewCStr(initialValue.toString());
          const { radix, prec, flags } = normalizeOptionsObject(opts, "parse");
          wasmFns.bf_atof(ptr, strPtr, 0, radix, prec, flags);
          wasmFns.free(strPtr);
        } else {
          throw new Error(`can't initialize to initial value ${initialValue}`);
        }
        this[readFromMemory](ptr);
      }
    }

    [memUtils.initRegister](ptr) {
      // make sure register reflects canonical state
      // stored on this instance
      wasmFns.bf_init(ptr);
      if (ptr % wordSize !== 0)
        throw new Error(`ptr ${ptr} not aligned to word size ${wordSize}`);
      const start = ptr / wordSize;
      memViews.sword[start] = this.sign;
      memViews.sword[start + 1] = this.expn;
      if (this.tab == null) {
        wasmFns.bf_resize(ptr, 0);
      } else {
        wasmFns.bf_resize(ptr, this.tab.length);
        memViews.uint8.set(this.tab, memViews.word[start + 3]);
      }
    }

    [memUtils.clearRegister](ptr) {
      wasmFns.bf_resize(ptr, 0);
    }

    [readFromMemory](ptr) {
      if (ptr % wordSize !== 0)
        throw new Error(`ptr ${ptr} not aligned to word size ${wordSize}`);
      const start = ptr / wordSize;
      this.sign = memViews.sword[start];
      this.expn = memViews.sword[start + 1];
      const tabLen = memViews.word[start + 2];
      if (this.tab != null && tabLen * wordSize <= this.tab.buffer.byteLength) {
        this.tab = this.tab.subarray(0, tabLen);
      } else if (tabLen > 0) {
        this.tab = new WordArray(new ArrayBuffer(tabLen * wordSize));
      } else {
        this.tab = null;
        return;
      }

      const tabPtr = memViews.word[start + 3];
      if (tabPtr % wordSize !== 0)
        throw new Error(
          `tabPtr ${tabPtr} not aligned to word size ${wordSize}`
        );

      const tabStart = tabPtr / wordSize;
      this.tab.set(memViews.word.subarray(tabStart, tabStart + tabLen));
    }

    toNumber(opts) {
      const ptr = ensureRegister(this);
      if (ptr % wordSize !== 0)
        throw new Error(`ptr ${ptr} not aligned to word size ${wordSize}`);
      const resPtr = wasmFns.malloc(doubleSize);
      if (resPtr % doubleSize !== 0)
        throw new Error(
          `resPtr ${resPtr} not aligned to double size ${doubleSize}`
        );

      const { roundingMode } = normalizeOptionsObject(opts);

      wasmFns.bf_get_float64(ptr, resPtr, roundingMode);

      const res = memViews.float64[resPtr / doubleSize];

      wasmFns.free(resPtr);
      return res;
    }

    toString(opts) {
      const ptr = ensureRegister(this);
      if (ptr % wordSize !== 0)
        throw new Error(`ptr ${ptr} not aligned to word size ${wordSize}`);
      const strPtrPtr = wasmFns.malloc(wordSize);
      if (strPtrPtr % wordSize !== 0)
        throw new Error(
          `strPtrPtr ${strPtrPtr} not aligned to word size ${wordSize}`
        );
      const { radix, prec, flags } = normalizeOptionsObject(opts, "toString");
      const sizeWritten = wasmFns.bf_ftoa(
        strPtrPtr,
        ptr,
        radix || 10,
        prec,
        flags
      );
      const res = memUtils.cstrToString(
        memViews.word[strPtrPtr / wordSize],
        sizeWritten
      );
      wasmFns.free(strPtrPtr);
      return res;
    }

    toIEEE754Hex(opts) {
      const { prec, expnBits } = normalizeOptionsObject(opts);
      const biasedExpnLimit = Math.pow(2, expnBits);

      const signBit = this.sign ? 1 : 0;
      let skipFirstFracBit = true;
      let extraFracZeroes = 0;
      let biasedExpn;
      if (this.expn === bf.expnZero) biasedExpn = 0;
      else if (this.expn === bf.expnInf || this.expn === bf.expnNaN)
        biasedExpn = biasedExpnLimit - 1;
      else {
        const expnBias = Math.pow(2, expnBits - 1) - 2;
        biasedExpn = this.expn + expnBias;
        if (biasedExpn <= 0 && biasedExpn > 1 - prec) {
          extraFracZeroes = -biasedExpn;
          skipFirstFracBit = false;
          biasedExpn = 0;
        } else if (biasedExpn >= biasedExpnLimit)
          throw new Error(
            `can't represent ${this.toString()} as IEEE 754 given precision ${prec} and ${expnBits} exponent bits`
          );
      }

      const resBuf = new ArrayBuffer(Math.ceil((prec + expnBits) / 8));
      const resView = new DataView(resBuf);

      const resHeader = ((signBit << expnBits) | biasedExpn) << (31 - expnBits);
      resView.setInt32(0, resHeader);

      const fracStart = Math.floor((expnBits + 1 + extraFracZeroes) / 8);
      const fracStartOffset = (expnBits + 1 + extraFracZeroes) % 8;
      if (this.expn === bf.expnNaN) {
        resView.setUint8(
          fracStart,
          resView.getUint8(fracStart) | (0x80 >>> fracStartOffset)
        );
      } else if (this.tab != null) {
        const tabBytes = new Uint8Array(
          this.tab.buffer,
          this.tab.byteOffset,
          this.tab.byteLength
        );
        const byteOffset = skipFirstFracBit
          ? fracStartOffset - 1
          : fracStartOffset;
        const byteMask = (1 << byteOffset) - 1;
        resView.setUint8(
          fracStart,
          resView.getUint8(fracStart) |
            ((tabBytes[tabBytes.length - 1] &
              (skipFirstFracBit ? 0x7f : 0xff)) >>>
              byteOffset)
        );
        for (
          let i = 1;
          i < tabBytes.length && fracStart + i < resView.byteLength;
          i++
        ) {
          resView.setUint8(
            fracStart + i,
            ((tabBytes[tabBytes.length - i] & byteMask) << (8 - byteOffset)) |
              (tabBytes[tabBytes.length - i - 1] >>> byteOffset)
          );
        }
      }

      return (
        "0x" +
        Array.from(new Uint8Array(resBuf))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("")
      );
    }

    [inspectCustom](depth, options) {
      return `${options.stylize("bf", "name")}(${options.stylize(
        `'${this.toString()}'`,
        "string"
      )})`;
    }
  }

  function bf() {
    return new BigFloat(...arguments);
  }
  bf.prototype = BigFloat.prototype;

  bf.expnBitsMin = 3;
  bf.expnBitsMax = wordSize * 8 - 2;
  bf.expnZero = -Math.pow(2, wordSize * 8 - 1);
  bf.expnInf = Math.pow(2, wordSize * 8 - 1) - 2;
  bf.expnNaN = Math.pow(2, wordSize * 8 - 1) - 1;
  bf.precMin = 2;
  bf.precMax = Math.pow(2, bf.expnBitsMax) - 2;
  bf.precInf = bf.precMax + 1;
  bf.flagAllowSubnormal = 1 << 3;
  bf.flagExpnBitsShift = 4;

  bf.parseFlags = {};
  bf.parseFlags.noHex = 1 << 16;
  bf.parseFlags.binOct = 1 << 17;
  bf.parseFlags.intOnly = 1 << 18;
  bf.parseFlags.noPrefixAfterSign = 1 << 19;
  bf.parseFlags.jsQuirks = 1 << 20;
  bf.parseFlags.intPrecInf = 1 << 21;
  Object.freeze(bf.parseFlags);

  bf.toStringFlags = {};
  bf.toStringFlags.formatNames = {};
  bf.toStringFlags.formats = {};
  [
    ["fixed", 0 << 16],
    ["frac", 1 << 16],
    ["free", 2 << 16],
    ["freeMin", 3 << 16]
  ].forEach(([name, value]) => {
    bf.toStringFlags.formatNames[value] = name;
    bf.toStringFlags.formats[name] = value;
  });
  Object.freeze(bf.toStringFlags.formatNames);
  Object.freeze(bf.toStringFlags.formats);
  bf.toStringFlags.forceExp = 1 << 20;
  bf.toStringFlags.addPrefix = 1 << 21;
  bf.toStringFlags.jsQuirks = 1 << 22;
  Object.freeze(bf.toStringFlags);

  bf.roundingModeNames = {};
  bf.roundingModes = {};
  [
    ["roundTiesToEven", 0],
    ["roundTowardZero", 1],
    ["roundTowardNegative", 2],
    ["roundTowardPositive", 3],
    ["roundTiesToAwayZero", 4],
    ["roundFaithful", 5]
  ].forEach(([name, value]) => {
    bf.roundingModeNames[value] = name;
    bf.roundingModes[name] = value;
  });
  Object.freeze(bf.roundingModeNames);
  Object.freeze(bf.roundingModes);

  bf.defaultPrecision = 53;
  bf.defaultExpnBits = 11;
  bf.defaultRoundingMode = "roundTiesToEven";
  bf.defaultAllowSubnormal = true;
  bf.defaultToStringFormat = "freeMin";

  bf.isBigFloat = function isBigFloat(x) {
    return typeof x === "object" && x instanceof BigFloat;
  };

  [
    { numInputs: 0, numOutputs: 1, opNames: ["const_log2", "const_pi"] },
    {
      numInputs: 1,
      numOutputs: 1,
      opNames: [
        "sqrt",
        "exp",
        "log",
        "cos",
        "sin",
        "tan",
        "acos",
        "asin",
        "atan"
      ]
    },
    {
      numInputs: 2,
      numOutputs: 1,
      opNames: [
        "add",
        "sub",
        "mul",
        "div",
        "fmod",
        "remainder",
        "logic_or",
        "logic_xor",
        "logic_and",
        "pow",
        "atan2"
      ]
    }
  ].forEach(({ numInputs, numOutputs, opNames }) => {
    opNames.forEach(opName => {
      const jsName = camelize(opName);
      bf[jsName] = {
        [jsName]() {
          const opts = normalizeOptionsObject(arguments[numInputs]);
          const inputs = Array.prototype.slice
            .call(arguments, 0, numInputs)
            .map(x => (bf.isBigFloat(x) ? x : bf(x, opts)));
          const outputs = Array.from({ length: numOutputs }, () =>
            bf(null, opts)
          );

          const { prec, flags } = opts;

          const outputPtrs = outputs.map(ensureRegister);

          wasmFns[`bf_${opName}`](
            ...outputPtrs,
            ...inputs.map(ensureRegister),
            prec,
            flags
          );
          outputs.forEach((output, i) => output[readFromMemory](outputPtrs[i]));

          return outputs.length === 1 ? outputs[0] : outputs;
        }
      }[jsName];

      if (numInputs > 0) {
        bf.prototype[jsName] = {
          [jsName](...args) {
            return bf[jsName](this, ...args);
          }
        }[jsName];
      }
    });
  });

  return bf;
};
