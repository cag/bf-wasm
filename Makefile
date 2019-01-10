CC = clang
CFLAGS = -O3 --target=wasm32
SRCS = libbf.c cutils.c malloc.c
HEADERS = cutils.h libbf.h
OBJS = $(SRCS:.c=.o)

CFLAGS += -DLACKS_TIME_H
CFLAGS += -DLACKS_UNISTD_H
CFLAGS += -DHAVE_MMAP=0

MUSL_OBJ_SRC = ~/src/git.musl-libc.org/musl/obj/src

MUSL_OBJS += $(MUSL_OBJ_SRC)/errno/strerror.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/fwrite.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__stdio_exit.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__stdio_close.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__lockfile.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/vsnprintf.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/stderr.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__stdio_seek.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/vfprintf.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/ofl.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__stdio_write.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/fprintf.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/__towrite.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/stdio/fflush.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/locale/__lctrans.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/math/frexpl.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/math/__signbitl.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/math/__fpclassifyl.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/memset.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/memchr.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/strlen.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/memcpy.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/memmove.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/string/strnlen.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/internal/syscall_ret.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/internal/libc.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/signal/block.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/signal/raise.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/thread/__lock.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/exit/assert.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/exit/abort.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/multibyte/wctomb.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/multibyte/wcrtomb.o
MUSL_OBJS += $(MUSL_OBJ_SRC)/errno/__errno_location.o


all: bf.wat

bf.wat: bf.wasm
	wasm2wat -o $@ $<

bf.wasm: $(OBJS)
	wasm-ld --no-entry --export-dynamic --export=malloc --export=free --stack-first --allow-undefined-file=wasm.syms -o $@ $(OBJS) $(MUSL_OBJS)
	chmod -x $@

%.o: %.c $(HEADERS)
	$(CC) $(CFLAGS) -o $@ -c $<

clean:
	rm -f *.o *.wasm *.wat
