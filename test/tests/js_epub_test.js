TestCase("JsEpubTest", {
    setUp: function () {
    },

    tearDown: function () {
    },

    "test unzipping blob": function () {
	var expectedBlob = "arf";
	var actualBlob;
	var entries = "any object here";
	JSEpub.prototype.unzipperConstructor = function (blob) {
	    actualBlob = blob;
	}
	JSEpub.prototype.unzipperConstructor.prototype = {
	    isZipFile: function () { return true },
	    readEntries: function () {},
	    entries: entries
	}

	var e = new JSEpub(expectedBlob);
	e.unzipBlob();
	assertEquals(expectedBlob, actualBlob);
	assertEquals(entries, e.entries);
    },

    "test read": function () {
	var e = new JSEpub();
	var timesInflated = 0;

	JSEpub.prototype.inflater = {inflate: function () {
	    timesInflated++;
	}};
	// Mocked JSUnzip output.
	e.entries = [
	    {
		fileName: "mimetype",
		data: "application/epub+zip",
		compressionMethod: 0
	    },
	    {
		fileName: "META-INF/container.xml", 
		data: "",
		compressionMethod: 8
	    },
	    {
		fileName: "anything.nxc",
		data: "",
		compressionMethod: 8
	    },
	    {
		fileName: "content/a_page.html",
		data: "",
		compressionMethod: 8
	    }
	]

	e.readEntries();

	assertEquals(3, timesInflated);
	assertEquals("application/epub+zip", e.mimetype);
    },

    "test invalid compression method": function () {
    },

    "test valitate": function () {
    },

    "test reading container": function () {
        var xml = ""
            + '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<container version="1.0">\n'
            + '  <rootfiles>\n'
            + '    <rootfile full-path="foo.opf" />\n'
            + '  </rootfiles>\n'
            + '</container>\n';
        var e = new JSEpub();
        e.container = xml;
        assertEquals("foo.opf", e.getOpfPathFromContainer());
    },

    "test reading  opf": function () {
        var xml = ""
            + '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<package>\n'
            + '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n'
            + '    <dc:language>en</dc:language>\n'
            + '    <dc:title>My Book</dc:title>\n'
            + '    <dc:creator opf:role="aut">Santa Claus</dc:creator>\n'
            + '    <dc:creator opf:role="aut">Rudolf</dc:creator>\n'
            + '    <dc:publisher>North Pole</dc:publisher>\n'
            + '    <dc:identifier opf:scheme="ISBN">1-123456-78-9</dc:identifier>\n'
            + '  </metadata>\n'
            + '  <manifest>\n'
            + '    <item id="book-css" href="css/book.css" media-type="text/css"/>\n'
            + '    <item id="chap1" href="chap1.html" media-type="application/xhtml+xml"/>\n'
            + '    <item id="chap2" href="chap2.html" media-type="application/xhtml+xml"/>\n'
            + '    <item id="nxc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n'
            + '  </manifest>\n'
            + '  <spine toc="ncx">\n'
            + '    <itemref idref="chap1"/>\n'
            + '    <itemref idref="chap2"/>\n'
            + '  </spine>\n'
            + '</package>\n';
        var e = new JSEpub();
        var opf = e.readOpf(xml);
        assertEquals(opf.metadata["dc:language"]._text, "en");
        assertEquals(opf.metadata["dc:creator"]["opf:role"], "aut");
        assertEquals(opf.metadata["dc:identifier"]["opf:scheme"], "ISBN");
        assertEquals(opf.metadata["dc:identifier"]._text, "1-123456-78-9");
        assertEquals(opf.manifest["book-css"]["href"], "css/book.css");
        assertEquals(opf.manifest["book-css"]["media-type"], "text/css");
        assertEquals(opf.manifest["chap1"]["href"], "chap1.html");
        assertEquals(opf.spine, ["chap1", "chap2"]);
    }
});