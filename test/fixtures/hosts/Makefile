CC := gcc
SRC := $(wildcard src/*.c)

.PHONY: build clean
build: $(SRC)
	@mkdir -p $(dir $@)
	$(CC) -o $@ $^ && echo "built $@ at $$(date +%F)"
	-for f in $^; do \
	  [[ -s "$$f" ]] && echo "$$f"; \
	done
clean:
	rm -rf build/ *.o
