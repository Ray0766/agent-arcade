# Photo thumbnail codecs

The standalone service includes the synchronous PNG reader/writer from [pngjs 7.0.0](https://github.com/pngjs/pngjs) under its [MIT license](pngjs/LICENSE). The local reader uses Node 24's bounded inflate for both interlaced and non-interlaced data.

The JPEG decoder comes from [jpeg-js 0.4.4](https://github.com/jpeg-js/jpeg-js), distributed with its [BSD license](jpeg-js/LICENSE) and the decoder's original Apache-2.0 copyright header. The [Apache license](../../../LICENSES/Apache-2.0.txt) is included in the project.
