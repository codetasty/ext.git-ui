define(function(require, exports, module) {
	var Fn = require('core/fn');
	
	var DIFF_MAX_LENGTH = 2000;
	
	var LINE_STATUS = {
		HEADER: 0,
		UNCHANGED: 1,
		REMOVED: 2,
		ADDED: 3,
		EOF: 4
	};
	
	var Extension;

	var Utils = {
		setExtension: function(extension) {
			Extension = extension;
		},
		formatDiff: function(diff) {
			var tabReplace = "",
				verbose = Extension.getStorage().useVerboseDiff,
				numLineOld = 0,
				numLineNew = 0,
				lastStatus = 0,
				diffData = [];

			var i = 2; //tab size
			while (i--) {
				tabReplace += "&nbsp;";
			}

			var diffSplit = diff.split("\n");

			if (diffSplit.length > DIFF_MAX_LENGTH) {
				return "<div>Diff is too long</div>";
			}

			diffSplit.forEach(function(line) {
				if (line === " ") {
					line = "";
				}

				var lineClass = "",
					pushLine = true;

				if (line.indexOf("diff --git") === 0) {
					lineClass = "diffCmd";

					diffData.push({
						name: line.split("b/")[1],
						lines: []
					});

					if (!verbose) {
						pushLine = false;
					}
				} else if (line.match(/index\s[A-z0-9]{7}\.\.[A-z0-9]{7}/)) {
					if (!verbose) {
						pushLine = false;
					}
				} else if (line.substr(0, 3) === "+++" || line.substr(0, 3) === "---") {
					if (!verbose) {
						pushLine = false;
					}
				} else if (line.indexOf("@@") === 0) {
					lineClass = "position";

					// Define the type of the line: Header
					lastStatus = LINE_STATUS.HEADER;

					// This read the start line for the diff and substract 1 for this line
					var m = line.match(/^@@ -([,0-9]+) \+([,0-9]+) @@/);
					var s1 = m[1].split(",");
					var s2 = m[2].split(",");

					numLineOld = s1[0] - 1;
					numLineNew = s2[0] - 1;
				} else if (line[0] === "+") {
					lineClass = "added";
					line = line.substring(1);

					// Define the type of the line: Added
					lastStatus = LINE_STATUS.ADDED;

					// Add 1 to the num line for new document
					numLineNew++;
				} else if (line[0] === "-") {
					lineClass = "removed";
					line = line.substring(1);

					// Define the type of the line: Removed
					lastStatus = LINE_STATUS.REMOVED;

					// Add 1 to the num line for old document
					numLineOld++;
				} else if (line[0] === " " || line === "") {
					lineClass = "unchanged";
					line = line.substring(1);

					// Define the type of the line: Unchanged
					lastStatus = LINE_STATUS.UNCHANGED;

					// Add 1 to old a new num lines
					numLineOld++;
					numLineNew++;
				} else if (line === "\\ No newline at end of file") {
					lastStatus = LINE_STATUS.EOF;
					lineClass = "end-of-file";
				} else {
					// console.log("Unexpected line in diff: " + line);
				}

				if (pushLine) {
					var _numLineOld = null,
						_numLineNew = null;

					switch (lastStatus) {
						case LINE_STATUS.HEADER:
						case LINE_STATUS.EOF:
							// _numLineOld = "";
							// _numLineNew = "";
							break;
						case LINE_STATUS.UNCHANGED:
							_numLineOld = numLineOld;
							_numLineNew = numLineNew;
							break;
						case LINE_STATUS.REMOVED:
							_numLineOld = numLineOld;
							// _numLineNew = "";
							break;
							// case LINE_STATUS.ADDED:
						default:
							// _numLineOld = "";
							_numLineNew = numLineNew;
					}

					// removes ZERO WIDTH NO-BREAK SPACE character (BOM)
					line = line.replace(/\uFEFF/g, "");

					// exposes other potentially harmful characters
					line = line.replace(/[\u2000-\uFFFF]/g, function(x) {
						return "<U+" + x.charCodeAt(0).toString(16).toUpperCase() + ">";
					});

					line = Fn.escape(line)
						.replace(/\t/g, tabReplace)
						.replace(/\s/g, "&nbsp;");

					line = line.replace(/(&nbsp;)+$/g, function(trailingWhitespace) {
						return "<span class='trailingWhitespace'>" + trailingWhitespace + "</span>";
					});

					if (diffData.length > 0) {
						diffData[diffData.length-1].lines.push({
							"numLineOld": _numLineOld,
							"numLineNew": _numLineNew,
							"line": line,
							"lineClass": lineClass
						});
					}
				}
			});
			
			var html = [];
			
			for (var i = 0; i < diffData.length; i++) {
				var file = diffData[i];
				
				// html.push('<tr class="meta-file"><th colspan="3">' + file.name + '</th></tr>');
				
				for (var j = 0; j < file.lines.length; j++) {
					html.push('<tr class="diff-row ' + file.lines[j].lineClass + '">\
						<td class="row-num">' + (file.lines[j].numLineOld || '') + '</td>\
						<td class="row-num">' + (file.lines[j].numLineNew || '') + '</td>\
						<td><pre>' + file.lines[j].line + '</pre></td>\
					</tr>');
				}
				// html.push('<tr class="separator"></tr>');
			}
			
			return html.join('');
		}
	};

	module.exports = Utils;
});