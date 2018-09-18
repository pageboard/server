
nodeModules := node_modules/@pageboard
modules := $(wildcard ./modules/*)
links := $(patsubst ./modules/%,$(nodeModules)/%,$(modules))

all: $(nodeModules) $(links)

$(nodeModules):
	mkdir -p $@

$(nodeModules)/%: modules/%
	ln -s ../../$< $@

clean:
	rm $(nodeModules)/*

install:
	npm install --prod

