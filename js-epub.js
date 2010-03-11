(function (GLOBAL) {
    var JSEpub = function (blob) {
        this.blob = blob;
    }

    GLOBAL.JSEpub = JSEpub;

    JSEpub.prototype = {
        // For mockability
        unzipper: function (blob) {
            return new JSUnzip(blob);
        },
        inflate: function(blob) {
            return JSInflate.inflate(blob);
        },

        // None-blocking processing of the EPUB. The notifier callback will
        // get called with a number and a optional info parameter on various
        // steps of the processing:
        //
        //  1: Unzipping
        //  2: Uncompressing file. File name passed as 2nd argument.
        //  3: Reading OPF
        //  4: Post processing
        //  5: Finished!
        //
        // Error codes:
        //  -1: File is not a proper Zip file.
        processInSteps: function (notifier) {
            notifier(1);
            this.unzipBlob(notifier);

            this.files = {};
            this.uncompressNextCompressedFile(notifier);
            // When all files are decompressed, uncompressNextCompressedFile
            // will continue with the next step.
        },

        unzipBlob: function (notifier) {
            var unzipper = this.unzipper(this.blob);
            if (!unzipper.isZipFile()) {
                notifier(-1);
                return;
            }

            unzipper.readEntries();
            this.compressedFiles = unzipper.entries;
        },

        uncompressNextCompressedFile: function (notifier) {
            var self = this;
            var compressedFile = this.compressedFiles.shift();
            if (compressedFile) {
                notifier(2, compressedFile.fileName);
                this.uncompressFile(compressedFile);
                this.withTimeout(this.uncompressNextCompressedFile, notifier);
            } else {
                this.didUncompressAllFiles(notifier);
            }
        },
        
        // For mockability
        withTimeout: function (func, notifier) {
            var self = this;
            setTimeout(function () {
                func.call(self, notifier);
            }, 30);
        },

        didUncompressAllFiles: function (notifier) {
            notifier(3);
            this.opfPath = this.getOpfPathFromContainer();
            this.readOpf(this.files[this.opfPath]);

            notifier(4);
            this.postProcess();
            notifier(5);
        },

	uncompressFiles: function () {
            this.files = {};

            for (var i = 0, il = this.entries.length; i < il; i++) {
                this.uncompressFile(this.entries[i]);
            }
        },

        uncompressFile: function (compressedFile) {
            var data;
            if (compressedFile.compressionMethod === 0) {
                data = compressedFile.data;
            } else if (compressedFile.compressionMethod === 8) {
                data = this.inflate(compressedFile.data);
            } else {
                throw new Error("Unknown compression method "
                                + compressedFile.compressionMethod 
                                + " encountered.");
            }

            if (compressedFile.fileName === "META-INF/container.xml") {
                this.container = data;
            } else if (compressedFile.fileName === "mimetype") {
                this.mimetype = data;
            } else {
                this.files[compressedFile.fileName] = data;
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