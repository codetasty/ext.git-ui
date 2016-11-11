	var FILE_STATUS = {
		NEW_FILE: 0,
		CHANGED: 1
	};
	
			diffSplit.forEach(function(line, i) {
				if (line === "") {
					return;
				}
				
						type: FILE_STATUS.CHANGED,
					
					if (!verbose) {
						pushLine = false;
					}
				} else if (line.indexOf("new file mode") === 0) {
					if (diffData.length) {
						diffData[diffData.length-1].type = FILE_STATUS.NEW_FILE;
					}
					
					if (!verbose) {
						pushLine = false;
					}
				
				html.push('<tr class="meta-file"><th colspan="3">' + file.name + ' <div class="file-tag file-' + (file.type == FILE_STATUS.NEW_FILE ? 'new' : 'changed') + '">' + (file.type == FILE_STATUS.NEW_FILE ? 'New file' : 'Changed') + '</div></th></tr>');
				html.push('<tr class="separator"></tr>');