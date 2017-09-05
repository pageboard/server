all: pageboard.ico

clean:
	rm -f pageboard.png
	rm -f pageboard.ico

pageboard.ico: pageboard.png
	mogrify -format ico -define icon:auto-resize=64,32,16 pageboard.png

pageboard.png: pageboard.svg
	convert -background none pageboard.svg pageboard.png

