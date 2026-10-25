/** Matches `XML_DEFAULT_MAX_INPUT_BYTES` in `omni-viewer-core/parsers/xml`:
 *  the parser refuses anything larger, so the host does not read past it.
 *  It lives apart from the viewer so the detection path can share the
 *  extension list without pulling the core into the extension bundle. */
export const MAX_XML_READ_BYTES = 64 * 1024 * 1024;

/** Mirrors `XML_VIEWER_META.extensions` in `omni-viewer-core/viewers/xml`.
 *  ARXML and ReqIF keep their dedicated viewers, and an OpenVINO IR `.xml`
 *  is recognized by content before this list is consulted. */
export const XML_EXTENSIONS: ReadonlySet<string> = new Set([
    '.xml', '.xsd', '.xsl', '.xslt', '.wsdl', '.xlf', '.xliff', '.rss', '.atom',
    '.xaml', '.kml', '.gpx', '.resx', '.csproj', '.vcxproj', '.nuspec'
]);
