/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2018 Center for History and New Media
					George Mason University, Fairfax, Virginia, USA
					http://zotero.org
	
	This file is part of Zotero.
	
	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
	
	***** END LICENSE BLOCK *****
*/
var config = {
  fieldURL: 'https://www.zotero.org/google-docs/?',
  fieldKeyLength: 6,
  citationPlaceholder: "{Updating}",
  fieldPrefix: "Z_F",
  dataPrefix: "Z_D",
  biblStylePrefix: "Z_B",
  twipsToPoints: 0.05
};

var NOTE_FOOTNOTE = 1;
var NOTE_ENDNOTE = 2;

var doc, bodyRange;
var extraReturnData = {};

function callMethod(documentUrl, method, args) {
  doc = DocumentApp.openById(documentUrl);
  bodyRange = doc.newRange().addElement(doc.getBody()).build();

  var fn = exposed[method];
  if (!fn) {
    throw new Error('Function `' + method + '` is not exposed');
  }
  
  var response = fn.apply(this, args);
  return Object.assign({response: response}, extraReturnData);
}

function getFields(prefix) {
  var rangeFields = {};
  prefix = prefix || config.fieldPrefix;
  var isField = config.fieldPrefix == prefix;
  doc.getNamedRanges().forEach(function(namedRange) {
    var name = namedRange.getName();
    if (name.indexOf(prefix) != 0) return;
    
    var key = "";
    if (isField) {
      key = name.substr(prefix.length, config.fieldKeyLength);
    }
    
    if (rangeFields[key]) {
      rangeFields[key].push(namedRange);
    } else {
      rangeFields[key] = [namedRange];
    }
  });
  var fields = [];
  if (isField) {
    filterFieldLinks(getAllLinks()).forEach(function(link) {
      var key = link.url.substr(config.fieldURL.length, config.fieldKeyLength);
      if (rangeFields[key]) {
        var field;
        if (rangeFields[key].exists) {
          var isBibl = rangeFields[key][0].getName().substr((prefix+key).length+3, 4) == 'BIBL';
          if (!isBibl) {
            // There are multiple links for the same key, which means that citations have been copied
            // so we need to assign them a new key and manually copy the named ranges associated with
            // the citation field code
            var newKey = changeFieldLinkKey(link);
            var ranges = copyNamedRanges(rangeFields[key], key, newKey);
            key = newKey;
            field = new Field(link, key, ranges, prefix);
          } else {
            rangeFields[key].exists.links.push(link);
            return;
          }
        } else {
          field = new Field(link, key, rangeFields[key], prefix);
          rangeFields[key].exists = field;
        }
        fields.push(field);
      } else if (key) {
        // Unlink orphaned links
        link.text.setLinkUrl(link.startOffset, link.endOffsetInclusive, null);
      }
    });
  }
  for (var key in rangeFields) {
    if (isField) {
      if (!rangeFields[key].exists) {
        for (var i = 0; i < rangeFields[key].length; i++) {
            rangeFields[key][i].remove();
        }
      }
    } else {
      var field = {code: decodeRanges(rangeFields[key], prefix), namedRanges: rangeFields[key]};
      fields.push(field);
    }
  }
  return fields;
}

/**
 * The idea here is to encode a field using the names of NamedRanges
 * https://developers.google.com/apps-script/reference/document/named-range
 * 
 * So for a citation like (Adam, 2017) we'll have multiple NamedRanges covering the text
 * each named Z_F000<part>, Z_F001<part> ... Z_F999<part>.
 * This is required because the maximum length of a name of a namedRange is 255 characters and
 * splitting it into 1000 parts allows us to encode about 25k characters for a field code.
 * 
 * @param range {Range}
 * @param code {String}
 * @param prefix {String} The prefix string to use for encoding.
 */
function encodeRange(range, code, prefix) {
  var codes = [];
  var i = 0;
  
  while (code.length) {
    var str = prefix + (i < 10 ? '00' : i < 100 ? '0' : '') + i;
    str += code.substr(0, 255 - prefix.length - 3);
    code = code.substr(255 - prefix.length - 3);
    codes.push(str);
    i++;
  }

  var ranges = [];
  for (i = 0; i < codes.length; i++) {
    ranges.push(doc.addNamedRange(codes[i], range));
  }
  return ranges;
}

function decodeRanges(namedRanges, prefix) {
  var codes = namedRanges.map(function(namedRange) {
    return namedRange.getName();
  });
  codes.sort();
  var code = "";
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    if (c.substr(prefix.length, 3) != i) {
      namedRanges.forEach(function(range) {
        range.remove();
      });
      console.error({
        message: "Ranges corrupt",
        error: new Error("Ranges corrupt on " + c.substr(0, prefix.length+3) + ".\n" + JSON.stringify(codes)),
        idx: i,
        codes: codes
      });
      throw new Error("Ranges corrupt on " + c.substr(0, prefix.length+3) + ".\n" + JSON.stringify(codes));
    }
    code += c.substr(prefix.length+3);
  }
  return code
}

var exposed = {};

exposed.getDocumentData = function() {
  var dataFields = getFields(config.dataPrefix);
  if (!dataFields.length) {
    return JSON.stringify({dataVersion: 4});
  } else {
    return dataFields[0].code;
  }
};

exposed.setDocumentData = function(data) {
  var dataFields = getFields(config.dataPrefix);
  if (dataFields) {
    dataFields.forEach(function(field) {
      field.namedRanges.forEach(function(namedRange) {
        namedRange.remove();
      });
    });
  }
  // Encode the document data directly onto the body of the document
  encodeRange(bodyRange, data, config.dataPrefix);
};

exposed.setBibliographyStyle = function(data) {
  var dataFields = getFields(config.biblStylePrefix);
  if (dataFields) {
    dataFields.forEach(function(field) {
      field.namedRanges.forEach(function(namedRange) {
        namedRange.remove();
      });
    });
  }
  encodeRange(bodyRange, data, config.biblStylePrefix);
};

exposed.footnotesToInline = function(fieldIDs) {
  var fields = getFields(config.fieldPrefix);
  var fieldMapping = {};
  fields.forEach(function(field) {
    // Don't convert fields that don't need conversion
    if (fieldIDs.indexOf(field.id) != -1) {
      fieldMapping[field.id] = field;
    }
  });
  var footnotes = doc.getFootnotes();
  footnotes.forEach(function(footnote) {
    var footnoteSection = footnote.getFootnoteContents();
    var textEl = footnoteSection.editAsText();
    var url = textEl.getLinkUrl(1);
    // First footnote character is usually a space, but if the second one is not a link
    // then we assume the footnote isn't a convertable Zotero field
    if (!url) return;
    var key = url.substr(config.fieldURL.length, config.fieldKeyLength);
    var field = fieldMapping[key];
    // The link is not for an existing field
    if (!field) return;
    
    var text = footnoteSection.getText();
    var fieldText = field.getText();
    // If the difference between lengths is greater than 1 (accounting for the first space), then
    // there is additional text in the footnote and it is unsafe to convert
    if (text.length - fieldText.length > 1
        // Also a sanity check.
        || text.indexOf(fieldText) == -1) {
      return;
    }
    // Good to convert!
    
    var paragraph = footnote.getParent();
    var footnoteIndex = paragraph.getChildIndex(footnote);
    textEl = paragraph.insertText(footnoteIndex, fieldText);
    textEl.setLinkUrl(field.links[0].url);
    
    footnote.removeFromParent();
    // Appallingly, Google Docs will happily remove the Footnote and keep the orphaned
    // FootnoteSection under the hood, fully queryable and editable with Apps Script
    // even though it is not shown in the actual editor.
    footnoteSection.removeFromParent();
  });
};

function getBibliographyStyle() {
  var biblStyle = getFields(config.biblStylePrefix);
  if (!biblStyle.length) {
    throw new Error("Trying to write bibliography without having set the bibliography style");
  }
  biblStyle = JSON.parse(biblStyle[0].code);
  var modifiers = {};
  // See https://github.com/zotero/zotero/blob/1f320e1f5d5fd818e2c2d532f4789e38792a77a2/chrome/content/zotero/xpcom/cite.js#L45 
  // For random constants
  
  // first line indent is calculated not from indent start, but from left margin in gdocs
  modifiers[DocumentApp.Attribute.INDENT_FIRST_LINE] = (biblStyle.bodyIndent+biblStyle.firstLineIndent) * config.twipsToPoints;
  modifiers[DocumentApp.Attribute.INDENT_START] = biblStyle.bodyIndent*config.twipsToPoints;
  modifiers[DocumentApp.Attribute.LINE_SPACING] = biblStyle.lineSpacing/240;
  modifiers[DocumentApp.Attribute.MARGIN_BOTTOM] = biblStyle.entrySpacing/240;
  // biblStyle.tabStops; no access via Apps Script currently.
  return modifiers;
}


exposed.getFields = function () {
  var fields = getFields();
  return fields.map(function(field) {
    return field.serialize();
  });
};

exposed.complete = function(insert, docPrefs, fieldChanges, bibliographyStyle) {
  if (insert) {
    exposed.insertField(insert);
  }
  if (docPrefs) {
    exposed.setDocumentData(docPrefs);
  }
  if (bibliographyStyle) {
    exposed.setBibliographyStyle(JSON.stringify(bibliographyStyle));
  }

  var fields = getFields();
  var fieldMap = {};
  fields.forEach(function(field) {
    fieldMap[field.id] = field;
  });
	var missingFields = [];
  // Perform in reverse order to keep field link position indices intact during update
  fieldChanges.reverse().forEach(function(fieldChange) {
    var field = fieldMap[fieldChange.id];
    if (!field) {
      missingFields.push(fieldChange.id);
      console.error({
        message: "Attempting to edit a non-existent field",
        fieldChange: fieldChange,
        existingFields: fields.map(function(field) {return field.id})
      });
      return;
    }
    if (fieldChange['delete']) {
      fieldMap[fieldChange.id]['delete']();
    } else {
      fieldMap[fieldChange.id].write(fieldChange);
      if (fieldChange.removeCode) {
        fieldMap[fieldChange.id].unlink();
      }
    }
  });
  
  if (missingFields.length > 0) {
    extraReturnData.error = "An error occurred while updating fields. " + JSON.stringify(missingFields);
  }
};

exposed.insertField = function(field) {
  var url = config.fieldURL + field.id;
  var links = filterFieldLinks(getAllLinks());
  var link;
  for (var i = 0; i < links.length; i++) {
    if (links[i].url == url) {
      link = links[i];
      break;
    }
  }
  if (!link) {
    console.error({
      message: "Failed to insert field. Could not find the placeholder link.",
	  error: new Error("Failed to insert field. Could not find the placeholder link.\n" + JSON.stringify(field)),
	  field: field
    });
    return false;
  }

  var namedRanges = encodeRange(bodyRange, field.code, config.fieldPrefix+field.id);
  return new Field(link, field.id, namedRanges, config.fieldPrefix).serialize();
};

var Field = function(link, key, namedRanges, prefix) {
  prefix = prefix || config.fieldPrefix;
  
  this.id = key;
  this.namedRanges = namedRanges;
  this.links = [link];
  
  this.code = decodeRanges(namedRanges, prefix+key);
  this.noteIndex = link.footnoteIndex;
};

Field.prototype = {
  /**
   * This is a destructive operation. The Field object becomes invalid after it because
   * you basically need to rescan the document for new link associations to make this.links valid again.
   * 
   * We don't do that for performance reasons and because you shouldn't need to use
   * this object again after writing without calling #getFields()
   * @param field
   */
  write: function(field) {
    var range = this.namedRanges[0].getRange();
    if (field.text) {
      var link = this.links[this.links.length-1];
      var startOffset = link.startOffset;

      link.text.deleteText(link.startOffset, link.endOffsetInclusive);
      var modifiers = {};
      var paragraphModifiers = {};
      modifiers[DocumentApp.Attribute.LINK_URL] = link.url;
      var isBibl = field.code && field.code.substr(0, 4) == "BIBL" || 
        this.code.substr(0, 4) == "BIBL";
      if (isBibl) {
        paragraphModifiers = getBibliographyStyle();
      }
      HTMLConverter.insert(link.text, field.text, modifiers, startOffset, paragraphModifiers);
      
      
      // Remove old text
      for (var i = this.links.length-2; i >= 0; i--) {
        link = this.links[i];
        var textStr = link.text.getText();
        if (textStr.length == link.endOffsetInclusive+1 - link.startOffset && i != this.links.length-1) {
          link.text.getParent().removeFromParent();
        } else {
          link.text.deleteText(link.startOffset, link.endOffsetInclusive);
        }
      }
      
      // Sigh. Removing a paragraph also removes paragraph styling of the next paragraph, 
      // so we apply it one more time here
      paragraphModifiers && this.links[this.links.length-1].text.getParent().setAttributes(paragraphModifiers);
      
      this.links = null;
    }
    
    if (field.code && this.code != field.code) {
      this.namedRanges.forEach(function(namedRange) {
        namedRange.remove();
      });
      this.namedRanges = encodeRange(range, field.code, config.fieldPrefix+this.id);
    }
  },
  
  getText: function() {
    if (!this.links) {
      throw new Error('Attempted to get the text of a field after write ' + this.id);
    }
    var text = "";
    this.links.forEach(function(link) {
      text += link.text.getText().substring(link.startOffset, link.endOffsetInclusive+1);
    });
    return text;
  },
  
  serialize: function() {
    return {id: this.id, text: this.getText(), code: this.code, noteIndex: this.noteIndex}
  },
  
  unlink: function() {
    this.namedRanges.forEach(function(namedRange) {
      namedRange.remove();
    });
    this.links.forEach(function(link) {
      link.text.setLinkUrl(link.startOffset, link.endOffsetInclusive, null);
    });
  },
  // Apps Script JS engine parses this as an illegal keyword
  "delete": function() {
    this.link.text.deleteText(this.link.startOffset, this.link.endOffsetInclusive);
    this.unlink();
  }
};

// ----- UTILITIES ----- //

var links = [];
/** (Modified from https://stackoverflow.com/a/40730088/3199106)
 * Returns a flat array of links which appear in the active document's body. 
 * Each link is represented by a simple Javascript object with the following 
 * keys:
 *   - "section": {ContainerElement} the document section in which the link is
 *     found. 
 *   - "isFirstPageSection": {Boolean} whether the given section is a first-page
 *     header/footer section.
 *   - "paragraph": {ContainerElement} contains a reference to the Paragraph 
 *     or ListItem element in which the link is found.
 *   - "text": the Text element in which the link is found.
 *   - "startOffset": {Number} the position (offset) in the link text begins.
 *   - "endOffsetInclusive": the position of the last character of the link
 *      text, or null if the link extends to the end of the text element.
 *   - "url": the URL of the link.
 *
 * @param {boolean} mergeAdjacent Whether consecutive links which carry 
 *     different attributes (for any reason) should be returned as a single 
 *     entry.
 * 
 * @returns {Array} the aforementioned flat array of links.
 */
function getAllLinks(mergeAdjacent) {
  if (links.length) return links;
  
  if (mergeAdjacent == undefined) mergeAdjacent = true;

  iterateSections(doc, function(section, sectionIndex, isFirstPageSection, footnoteIndex) {
    if (!("getParagraphs" in section)) {
      // as we're using some undocumented API, adding this to avoid cryptic
      // messages upon possible API changes.
      throw new Error("An API change has caused this script to stop " + 
                      "working.\n" +
                      "Section #" + sectionIndex + " of type " + 
                      section.getType() + " has no .getParagraphs() method. " +
        "Stopping script.");
    }

    section.getParagraphs().forEach(function(par) { 
      // skip empty paragraphs
      if (par.getNumChildren() == 0) {
        return;
      }

      // go over all text elements in paragraph / list-item
      for (var el=par.getChild(0); el!=null; el=el.getNextSibling()) {
        if (el.getType() != DocumentApp.ElementType.TEXT) {
          continue;
        }

        // go over all styling segments in text element
        var attributeIndices = el.getTextAttributeIndices();
        var lastLink = null;
        attributeIndices.forEach(function(startOffset, i, attributeIndices) { 
          var url = el.getLinkUrl(startOffset);

          if (url != null) {
            // we hit a link
            var endOffsetInclusive = (i+1 < attributeIndices.length? 
                                      attributeIndices[i+1]-1 : el.getText().length-1);

            // check if this and the last found link are continuous
            if (mergeAdjacent && lastLink != null && lastLink.url == url && 
                  lastLink.endOffsetInclusive == startOffset - 1) {
              // this and the previous style segment are continuous
              lastLink.endOffsetInclusive = endOffsetInclusive;
              return;
            }

            lastLink = {
              section: section,
              isFirstPageSection: isFirstPageSection,
              paragraph: par,
              text: el,
              startOffset: startOffset,
              endOffsetInclusive: endOffsetInclusive,
              url: url,
              footnoteIndex: footnoteIndex
            };

            links.push(lastLink);
          }        
        });
      }
    });
  });


  return links;
}

/**
 * Calls the given function for each section of the document (body, header, 
 * etc.). Sections are children of the DocumentElement object.
 *
 * @param {Document} doc The Document object (such as the one obtained via
 *     a call to DocumentApp.getActiveDocument()) with the sections to iterate
 *     over.
 * @param {Function} func A callback function which will be called, for each
 *     section, with the following arguments (in order):
 *       - {ContainerElement} section - the section element
 *       - {Number} sectionIndex - the child index of the section, such that
 *         doc.getBody().getParent().getChild(sectionIndex) == section.
 *       - {Boolean} isFirstPageSection - whether the section is a first-page
 *         header/footer section.
 */
function iterateSections(doc, func) {
  // get the DocumentElement interface to iterate over all sections
  // this bit is undocumented API
  var docEl = doc.getBody().getParent();

  var regularHeaderSectionIndex = (doc.getHeader() == null? -1 : 
                                   docEl.getChildIndex(doc.getHeader()));
  var regularFooterSectionIndex = (doc.getFooter() == null? -1 : 
                                   docEl.getChildIndex(doc.getFooter()));

  var footnoteIndex = 1;
  for (var i=0; i<docEl.getNumChildren(); ++i) {
    var section = docEl.getChild(i);

    var sectionType = section.getType();
    var uniqueSectionName;
    var isFirstPageSection = (
      i != regularHeaderSectionIndex &&
      i != regularFooterSectionIndex && 
      (sectionType == DocumentApp.ElementType.HEADER_SECTION ||
       sectionType == DocumentApp.ElementType.FOOTER_SECTION));

    if (section.getType() == DocumentApp.ElementType.FOOTNOTE_SECTION) {
      func(section, i, isFirstPageSection, footnoteIndex);
      footnoteIndex++;
    } else {
      func(section, i, isFirstPageSection, 0);
    }
  }
}

function getRangeLink(rangeElement) {
  var elem = rangeElement.getElement();
  if (elem.getType() != 'TEXT') {
    elem = elem.editAsText();
  }
  var url;
  if (rangeElement.isPartial()) {
    url = elem.getLinkUrl(rangeElement.getStartOffset()+1);
  } else {
    url = elem.getLinkUrl();
  }
  var links = getAllLinks();
  var idx;
  links.forEach(function(link, index) {
    if (link.url == url) idx = index;
  });
  return idx != -1 ? links[idx] : null;
}

function filterFieldLinks(links) {
  return links.filter(function (link) {
    return link.url.indexOf(config.fieldURL) == 0 && link.url.length == config.fieldURL.length + config.fieldKeyLength;
  })
}

function changeFieldLinkKey(link) {
  var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var newKey = '';
  for (var i = 0; i < config.fieldKeyLength; i++) {
    newKey += chars[Math.round(Math.random() * chars.length)];
  }
  var attr = {};
  attr[DocumentApp.Attribute.FOREGROUND_COLOR] = link.text.getForegroundColor(link.startOffset);
  attr[DocumentApp.Attribute.UNDERLINE] = link.text.isUnderline(link.startOffset);
  link.text.setLinkUrl(link.startOffset, link.endOffsetInclusive, config.fieldURL + newKey);
  link.text.setAttributes(link.startOffset, link.endOffsetInclusive, attr);
  return newKey;
}

function copyNamedRanges(ranges, oldKey, newKey) {
  var code = decodeRanges(ranges, config.fieldPrefix + oldKey);
  return encodeRange(bodyRange, code, config.fieldPrefix + newKey);
}

var HTMLConverter = {
  insertAt: 0,
  insertElem: null,
  insertedLength: 0,
  firstParagraph: true,
  insert: function(docsElem, html, modifiers, insertAt, paragraphModifiers) {
    if (docsElem.getType() != DocumentApp.ElementType.TEXT) {
      throw new Error('Attempting to insert rich text into non-Text object');
    }
    
    this.paragraphModifiers = paragraphModifiers;
    this.insertElem = docsElem;
    // doc.getBody() doesn't work for footnote links
    // this.insertElem is TEXT, parent is PARAGRAPH, parent above is BODY or FOOTNOTE_SECTION
    this.parentElem = this.insertElem.getParent().getParent();
    this.paragraphIndex = this.parentElem.getChildIndex(this.insertElem.getParent());
    
    this.insertAt = insertAt || 0;
    // Might cause styling issues
    this.defaultAttributes = this.insertElem.getAttributes();
    // Preserve link
    delete this.defaultAttributes[DocumentApp.Attribute.LINK_URL];
    try {
      if (html[0] != '<') {
        html = "<div>" + html + "</div>";
      }
      var xmlDoc = XmlService.parse(html);
    } catch (e) {
      // Something's wrong. Just append.
      this.insertElem.insertText(this.insertAt, html);
      return html.length;
    }

    // Insert formatted text
    HTMLConverter.addElem(xmlDoc.getRootElement(), modifiers);

    // Set params
    // var fontSize = this.insertElem.getFontSize() || 11;
    // params.linespacing && docsElem.setLineSpacing(params.linespacing);
    // params.entryspacing && docsElem.setSpacingAfter(params.entryspacing * fontSize);
    
    // Return inserted text length
    return this.insertedLength;
  },

  addElem: function(elem, modifiers) {
    modifiers = modifiers || {};
    if (elem.getType() == XmlService.ContentTypes.TEXT) {
      var text = elem.getText().replace(/[\n\r]/g, '').replace(/^\s*$/, '');
      if (text.length != 0) {
        return HTMLConverter.addText(text, Object.assign({}, modifiers));
      }
      return;
    }

    var elemName = elem.getName();
    switch (elemName) {
      case 'i':
      case 'em':
        modifiers[DocumentApp.Attribute.ITALIC] = true; break;
      case 'b':
        modifiers[DocumentApp.Attribute.BOLD] = true; break;
      case 'sup':
        modifiers['super'] = true; break;
      case 'sub':
        modifiers['sub'] = true; break;
    }

    var style = elem.getAttribute('style');
    style = style ? style.getValue() : null;
    switch (style) {
      case 'font-style:normal;':
        modifiers[DocumentApp.Attribute.ITALIC] = false; break;
      case 'font-variant:small-caps;':
        modifiers[DocumentApp.Attribute.FONT_FAMILY] = "Alegreya Sans SC"; break;
      case 'font-variant:normal;':
        break;
      case 'font-weight:normal;':
        modifiers[DocumentApp.Attribute.BOLD] = false; break;
      case 'text-decoration:none;':
        modifiers[DocumentApp.Attribute.UNDERLINE] = false; break;
      case 'text-decoration:underline;':
        modifiers[DocumentApp.Attribute.UNDERLINE] = true; break;
    }

    var cls = elem.getAttribute('class');
    cls = cls ? cls.getValue() : null;
    if (cls === 'csl-block') {
      this.insertElem.insertText(this.insertAt, "\n"); this.insertAt += 1; this.insertedLength += 1;
    }
    else if (cls === 'csl-indent') {
      this.insertElem.insertText(this.insertAt, "\t"); this.insertAt += 1; this.insertedLength += 1;
    }
    else if (cls === 'csl-entry') {
      // Don't insert the first paragraph, except when we're not in a new paragraph already
      if (!this.firstParagraph || this.insertAt != 0) {
        this.insertElem = this.parentElem.insertParagraph(this.paragraphIndex+1, "").editAsText();
        this.insertAt = 0;
        this.paragraphIndex++;
      }
      if (this.paragraphModifiers) {
        this.insertElem.setAttributes(this.paragraphModifiers);
      }
      this.firstParagraph = false;
    } else if (cls === 'delayed-zotero-citation-updates') {
      modifiers[DocumentApp.Attribute.BACKGROUND_COLOR] = "#dddddd";
    }

    var children = elem.getAllContent();
    for (var i = 0; i < children.length; i++) {
      HTMLConverter.addElem(children[i], Object.assign({}, modifiers));
    }

    if (cls === 'csl-block') {
      this.insertElem.insertText(this.insertAt, "\n"); this.insertAt += 1;
    }
  },

  addText: function(text, modifiers) {
    this.insertElem.insertText(this.insertAt, text);
    var start = this.insertAt;
    var end = start + text.length - 1;
    this.insertAt += text.length;
    this.insertedLength += text.length;
    
    var setSup = modifiers['sup'];
    var setSuper = modifiers['super'];
    delete modifiers['sup'];
    delete modifiers['super'];
    
    // Applying LINK_URL changes text color and underline.
    if (modifiers[DocumentApp.Attribute.LINK_URL]) {
      this.insertElem.setLinkUrl(start, end, modifiers[DocumentApp.Attribute.LINK_URL]);
      delete modifiers[DocumentApp.Attribute.LINK_URL];
    }
    // Need to explicitly set text alignment since there is no attribute
    // Why, Google? Why?
    if (setSup) {
      this.insertElem.setTextAlignment(start, end, DocumentApp.TextAlignment.SUBSCRIPT);
    } else if (setSuper) {
      this.insertElem.setTextAlignment(start, end, DocumentApp.TextAlignment.SUPERSCRIPT);
    } else {
      this.insertElem.setTextAlignment(start, end, DocumentApp.TextAlignment.NORMAL);
    }
    
    this.insertElem.setAttributes(start, end, Object.assign({}, this.defaultAttributes, modifiers));
  }
};

Object.assign = function(target) {
  if (target == null) {
    throw new TypeError('Cannot convert undefined or null to object');
  }

  target = Object(target);
  for (var index = 1; index < arguments.length; index++) {
    var source = arguments[index];
    if (source != null) {
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
  }
  return target;
};
