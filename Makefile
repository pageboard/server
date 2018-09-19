
modules := node_modules/@pageboard
packages := $(wildcard ./packages/*)
links := $(patsubst ./packages/%,$(modules)/%,$(packages))

all: $(modules) $(links) install

$(modules):
	mkdir -p $@

$(modules)/%: packages/%
	ln -s ../../$< $@

clean:
	rm $(modules)/*

install:
	npm install --prod

