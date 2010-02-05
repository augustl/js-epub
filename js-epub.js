(function (GLOBAL) {
    var JSEpub = function (blob) {
        this.blob = blob;
    }

    GLOBAL.JSEpub = JSEpub;

    JSEpub.prototype = {
        // For mockability
        unzipperConstructor: JSUnzip,
        inflater: JSInflate,

        unzipBlob: function () {
            var unzipper = new this.unzipperConstructor(this.blob);
            if (!unzipper.isZipFile()) {
                throw new Error("Provided file was not a zip file.");
            }

            unzipper.readEntries();
            this.entries = unzipper.entries;
        },

	readEntries: function () {
            this.files = {};

            for (var i = 0, il = this.entries.length; i < il; i++) {
                var entry = this.entries[i];
                var data;

                if (entry.compressionMethod === 0) {
                    data = entry.data;
                } else if (entry.compressionMethod === 8) {
                    data = this.inflater.inflate(entry.data);
                } else {
                    throw new Error("Unknown compression method "
                                    + entry.compressionMethod 
                                    + " encountered.");
                }

                if (entry.fileName === "META-INF/container.xml") {
                    this.container = data;
                } else if (entry.fileName === "mimetype") {
                    this.mimetype = data;
                } else {
                    this.files[entry.fileName] = entry.data;
                }
            }
        },

        getOpfPathFromContainer: function () {
            var doc = this.xmlDocument(this.container);
            return doc
                .getElementsByTagName("rootfile")[0]
                .getAttribute("full-path");
        },

        readOpf: function (xml) {
            var doc = this.xmlDocument(xml);
            
            try {
                var opf = {
                    metadata: {},
                    manifest: {},
                    spine: []
                };

                var metadataNodes = doc
                    .getElementsByTagName("metadata")[0]
                    .childNodes;

                for (var i = 0, il = metadataNodes.length; i < il; i++) {
                    var node = metadataNodes[i];
                    // Skip text nodes (whitespace)
                    if (node.nodeType === 3) { continue }

                    var attrs = {};
                    for (var i2 = 0, il2 = node.attributes.length; i2 < il2; i2++) {
                        var attr = node.attributes[i2];
                        attrs[attr.name] = attr.value;
                    }
                    attrs._text = node.textContent;
                    opf.metadata[node.nodeName] = attrs;
                }

                var manifestEntries = doc
                    .getElementsByTagName("manifest")[0]
                    .getElementsByTagName("item");

                for (var i = 0, il = manifestEntries.length; i < il; i++) {
                    var node = manifestEntries[i];
                    var attrs = {};
                    for (var i2 = 0, il2 = node.attributes.length; i2 < il2; i2++) {
                        var attr = node.attributes[i2];
                        if (attr.name === "id") { continue }
                        attrs[attr.name] = attr.value;
                    }
                    opf.manifest[node.getAttribute("id")] = attrs;
                }

                var spineEntries = doc
                    .getElementsByTagName("spine")[0]
                    .getElementsByTagName("itemref");

                for (var i = 0, il = spineEntries.length; i < il; i++) {
                    var node = spineEntries[i];
                    opf.spine.push(node.getAttribute("idref"));
                }

                this.opf = opf;
            } catch(e) {
                // The DOMParser will not throw an error if the XML is invalid.
                // It will return an XML error document, and it will be in
                // here:
                // doc.childNodes[1].childNodes[0].nodeValue
                throw(e)
            }
        },

        resolvePath: function (path, referrerLocation) {
            var pathDirs = path.split("/");
            var fileName = pathDirs.pop();

            var locationDirs = referrerLocation.split("/");
            locationDirs.pop();

            for (var i = 0, il = pathDirs.length; i < il; i++) {
                var spec = pathDirs[i];
                if (spec === "..") {
                    locationDirs.pop();
                } else {
                    locationDirs.push(spec);
                }
            }

            locationDirs.push(fileName);
            return locationDirs.join("/");
        },

        findMediaTypeByHref: function (href) {
            for (key in this.opf.manifest) {
                var item = this.opf.manifest[key];
                if (item["href"] === href) {
                    return item["media-type"];
                }
            }
        },

        // Will modify all HTML and CSS files in place, altering this.files.
        // All references to images (resources) will be replaced with data
        // uris.
        convertHttpUrisToDataUris: function () {
            var self = this;
            for (var key in this.opf.manifest) {
                var mediaType = this.opf.manifest[key]["media-type"]
                if (mediaType === "text/css") {
                    var href = this.opf.manifest[key]["href"];
                    var file = this.files[href];

                    file = file.replace(/url\((.*?)\)/gi, function (str, url) {
                        if (/^data/i.test(url)) {
                            // Don't replace data strings
                            return str;
                        } else {
                            var dataHref = self.resolvePath(url, href);
                            var mediaType = self.findMediaTypeByHref(dataHref);
                            var encodedData = escape(self.files[dataHref]);
                            return "url(data:" + mediaType + "," + encodedData + ")";
                        }
                    });

                    this.files[href] = file;
                } else if (mediaType === "application/xhtml+xml") {
                    var href = this.opf.manifest[key]["href"];
                    var file = this.files[href];

                    file = file.replace(/<img(.*?)src=['"](.*?)['"](.*?)\/>/gi, function (imgTag, beforeSrc, url, afterSrc) {
                        if (/^data/i.test(url)) {
                            // Don't replace data strings
                            return imgTag;
                        } else {
                            var dataHref = self.resolvePath(url, href);
                            var mediaType = self.findMediaTypeByHref(dataHref);
                            var encodedData = escape(self.files[dataHref]);
                            var src = "data:" + mediaType + "," + encodedData;
                            return "<img" + beforeSrc + 'src="' + src + '"' + afterSrc + "/>"
                        }
                    });

                    this.files[href] = file;
                }
            }
        },

        validate: function () {
            if (this.container === undefined) {
                throw new Error("META-INF/container.xml file not found.");
            }

            if (this.mimetype === undefined) {
                throw new Error("Mimetype file not found.");
            }

            if (this.mimetype !== "application/epub+zip") {
                throw new Error("Incorrect mimetype " + this.mimetype);
            }
        },

        // for data URIs
        escapeData: function (data) {
            return escape(data);
        },

        xmlDocument: function (xml) {
            return new DOMParser().parseFromString(xml, "text/xml");
        }
    }
}(this));