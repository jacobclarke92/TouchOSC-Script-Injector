# TouchOSC Script Injector

A neat little CLI tool that allows you to write TouchOSC LUA scripts externally by injecting them into the TouchOSC project file directly, with some bonus smarts.  

Here's a quick demo (v1.0.0):  
[![Demo on youtube](https://img.youtube.com/vi/-IrUO52OCpA/0.jpg)](https://www.youtube.com/watch?v=-IrUO52OCpA)


## Project setup

In the same folder as your `.tosc` project file make a folder called `scripts`, in there you can make as many `.lua` files as you want.  

`_globals.lua` is a special file that is always injected into the top of all other scripts.

`_root.lua` will get applied to your document's root script.

All other `.lua` files will map directly to any controls or groups of the same name. By pre-pending a file name with `tag_` the mapping will be done by tag instead of name.

This name/tag script copying process should find controls nested in however many groups.

## Using this thing

Head to [releases](https://github.com/jacobclarke92/TouchOSC-Script-Injector/releases) and download the version best suited for your OS.  
Windows, Mac and Linux options available.  
I've personally only tested on Mac so far but have heard window works fine.  

Simply run the program and follow the prompts!  

The program will run in its entirety after initially receiving a project file. It will create a new `_INJECTED.tosc` file next to your original.

After this point the program will monitor your `scripts` folder and watch for any changes to `.lua` files, patching your project file as necessary. If a change is made to the original `.tosc` fil the injection process with run afresh.


Note: whenever the program runs you'll need to close and reopen your `_INJECTED.tosc` project if you already have it open to see changes as TouchOSC understandably doesn't refresh itself if changes are detected.

---

## Dev stuff

Built with DENO just because I like typescript and the compile functionality seemed pretty convenient for distribution.

`.tosc` files by default are compressed with zlib, if decompressed end up just being an xml file.

Check the scripts inside `package.json` for quick access but otherwise this should be all you need to get started:  
```
deno run --allow-read --allow-write src/index.ts
```
There is a `--debug` argument that adds extra logs and outputs a debug `.json` file, and you can also pass a `.tosc` file path (relative or absolute) as an argument to skip the prompting step.


---

## Issues

The XML parsing lib isn't very performant once files get above the 1mb mark. I've not been able to find and good alternatives for deno as of now.


--- 

## To-do

If a script file is modified while XML re-encoding is in-progress, it should cancel and start over (taking into account change that was currently being processed + new change).