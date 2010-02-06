(function (GLOBAL) {
    var JSEpub = function (blob) {
        this.blob = blob;
    }

    GLOBAL.JSEpub = JSEpub;

    JSEpub.prototype = {
        // For mockability
        unzipperConstructor: JSUnzip,
        inflater: JSInflate,

        process: function () {
            this.unzipBlob();
            this.readEntries();
            this.opfPath = this.getOpfPathFromContainer();
            this.readOpf(this.files[this.opfPath]);
            this.postProcess();
        },

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
                    this.files[entry.fileName] = data;
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

                opf.manifest[node.getAttribute("id")] = {
                    "href": this.resolvePath(node.getAttribute("href"), this.opfPath),
                    "media-type": node.getAttribute("media-type")
                }
            }

            var spineEntries = doc
                .getElementsByTagName("spine")[0]
                .getElementsByTagName("itemref");

            for (var i = 0, il = spineEntries.length; i < il; i++) {
                var node = spineEntries[i];
                opf.spine.push(node.getAttribute("idref"));
            }

            this.opf = opf;
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

            // Best guess if it's not in the manifest. (Those bastards.)
            var match = href.match(/\.(\w+)$/);
            return match && "image/" + match[1];
        },

        // Will modify all HTML and CSS files in place.
        postProcess: function () {
            for (var key in this.opf.manifest) {
                var mediaType = this.opf.manifest[key]["media-type"]
                var href = this.opf.manifest[key]["href"]
                var result;

                if (mediaType === "text/css") {
                    result = this.postProcessCSS(href);
                } else if (mediaType === "application/xhtml+xml") {
                    result = this.postProcessHTML(href);
                }

                if (result !== undefined) {
                    this.files[href] = result;
                }
            }
        },

        postProcessCSS: function (href) {
            var file = this.files[href];
            var self = this;

            file = file.replace(/url\((.*?)\)/gi, function (str, url) {
                if (/^data/i.test(url)) {
                    // Don't replace data strings
                    return str;
                } else {
                    var dataUri = self.getDataUri(url, href);
                    return "url(" + dataUri + ")";
                }
            });

            return file;
        },

        postProcessHTML: function (href) {
            var xml = decodeURIComponent(escape(this.files[href]));
            var doc = this.xmlDocument(xml);

            var images = doc.getElementsByTagName("img");
            for (var i = 0, il = images.length; i < il; i++) {
                var image = images[i];
                var src = image.getAttribute("src");
                if (/^data/.test(src)) { continue }
                image.setAttribute("src", this.getDataUri(src, href))
            }

            var head = doc.getElementsByTagName("head")[0];
            var links = head.getElementsByTagName("link");
            for (var i = 0, il = links.length; i < il; i++) {
                var link = links[0];
                if (link.getAttribute("type") === "text/css") {
                    var inlineStyle = document.createElement("style");
                    inlineStyle.setAttribute("type", "text/css");
                    inlineStyle.setAttribute("data-orig-href", link.getAttribute("href"));

                    var css = this.files[this.resolvePath(link.getAttribute("href"), href)];
                    inlineStyle.appendChild(document.createTextNode(css));

                    head.replaceChild(inlineStyle, link);
                }
            }

            return doc;
        },

        getDataUri: function (url, href) {
            var dataHref = this.resolvePath(url, href);
            var mediaType = this.findMediaTypeByHref(dataHref);
            var encodedData = escape(this.files[dataHref]);
            return "data:" + mediaType + "," + encodedData;
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
            var doc = new DOMParser().parseFromString(xml, "text/xml");

            if (doc.childNodes[1] && doc.childNodes[1].nodeName === "parsererror") {
                throw doc.childNodes[1].childNodes[0].nodeValue;
            }

            return doc;
        }
    }
}(this));