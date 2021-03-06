(function() {
  var Color, SVGImage, SVGO, _, doT, fs, xmldom;

  Color = require('color');

  xmldom = require('xmldom');

  doT = require('dot');

  fs = require('fs');

  _ = require('lodash');

  SVGO = require('svgo');

  SVGImage = class SVGImage {
    constructor(filePath, options = {}) {
      var svgo;
      this.path = filePath;
      this.options = options;
      this.xml = options.content;
      this.sprite = options.sprite || {};
      this.defaults = _.isString(options.defaults) ? this._parseStyle(options.defaults) : {};
      this.colors = {};
      this.sprites = {};
      this.colorCount = 0;
      this.svgo = options.svgo ? svgo = new SVGO(_.isObject(options.svgo) ? options.svgo : {}) : false;
      this._parseSvg();
    }

    svgFor(ids) {
      var id, sprite;
      if (!ids || _.isEmpty(ids)) {
        return this;
      }
      id = `${this.sprite.prefix || ''}${ids[0]}${this.sprite.postfix || ''}`;
      if (sprite = this.sprites[id]) {
        return sprite.svgFor(ids.slice(1));
      } else {
        throw new Error(`Can\'t find sprite with id ${id}`);
      }
    }

    dataUrl(params = {}) {
      var svg;
      if (_.isString(params)) {
        params = this._parseStyle(params);
      }
      params = _.extend({}, this.defaults, params);
      svg = this.template(params);
      if (this.svgo) {
        svg = this._svgoSync(svg);
      }
      return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    }

    _svgoSync(svgString) {
      var result;
      result = false;
      this.svgo.optimize(svgString, function(str) {
        return result = str.data;
      });
      while (true) {
        if (result) {
          return result;
        }
      }
    }

    _parseStyle(string) {
      var i, key, len, ref, result, rule, value;
      result = {};
      if (!string || string.indexOf(':') === -1) {
        return result;
      }
      ref = string.replace(/[\s"]/g, '').split(';');
      for (i = 0, len = ref.length; i < len; i++) {
        rule = ref[i];
        if (rule.indexOf(':') !== -1) {
          [key, value] = rule.split(':');
          result[key] = value;
        }
      }
      return result;
    }

    _parseSvg() {
      var doc, result, xml;
      result = {};
      xml = this.xml || fs.readFileSync(this.path).toString();
      doc = new xmldom.DOMParser().parseFromString(xml, "image/svg+xml");
      this.svgAttributes = this._parseAttributes(doc.childNodes[0].attributes);
      doc = this._parseNode(doc, result, (node, attributes) => {
        return this._readColors(node, attributes);
      });
      this._checkSVG(doc);
      doc = new xmldom.XMLSerializer().serializeToString(doc);
      return this.template = doT.template(doc, _.extend(doT.templateSettings, {
        strip: false
      }));
    }

    _checkSVG(doc) {
      var transform;
      if (!(Object.keys(this.colors).length > 0)) {
        transform = function(key) {
          return `(it['[${key}]'] ? '${key}:'+it['[${key}]']+';' : '')`;
        };
        doc.setAttribute('style', `{{= ${_.map(['fill', 'stroke'], transform).join('+')} }}`);
      }
      if (!(this.svgAttributes.height || this.svgAttributes.width)) {
        doc.setAttribute('height', "{{= it['[height]'] || it['[size]'] || '100%' }}");
        return doc.setAttribute('width', "{{= it['[width]'] || it['[size]'] || '100%' }}");
      }
    }

    _parseNode(node, result, callback, path = '') {
      var attributes, i, len, nodePath, ref;
      if (node.childNodes) {
        ref = node.childNodes;
        for (i = 0, len = ref.length; i < len; i++) {
          node = ref[i];
          nodePath = path;
          if (node.tagName) {
            attributes = this._parseAttributes(node.attributes) || {};
            nodePath += `${(path === '' ? '' : '>')}${node.tagName}`;
            if (attributes.id && node.tagName !== 'svg') {
              nodePath += `#${attributes.id.value}`;
            }
            if (attributes.class) {
              nodePath += `.${attributes.class.value}`;
            }
            if (node.tagName === 'symbol') {
              this._addSprite(node);
            }
            attributes.path = nodePath;
            callback(node, attributes);
          }
          this._parseNode(node, result, callback, nodePath);
        }
      }
      return node;
    }

    _readColors(node, attributes) {
      if (attributes.fill) {
        this._addColor('fill', attributes, node);
      }
      if (attributes.stroke) {
        return this._addColor('stroke', attributes, node);
      }
    }

    _parseAttributes(attributes) {
      var attribute, index, result;
      result = {};
      if (attributes) {
        for (index in attributes) {
          attribute = attributes[index];
          if (parseInt(index, 10) > 0 || index === '0') {
            result[attribute.name] = {
              index: index,
              value: attribute.value
            };
          }
        }
      }
      return result;
    }

    _addSprite(node) {
      var attributes, id, key, ref, sprite, svg, value;
      if (node.tagName !== 'symbol') {
        return;
      }
      node = node.cloneNode(true);
      attributes = this._parseAttributes(node.attributes);
      node.tagName = 'svg';
      id = attributes.id && attributes.id.value || `sprite${(Object.keys(this.sprites).length)}`;
      ref = _.assign({}, this.svgAttributes, attributes);
      for (key in ref) {
        value = ref[key];
        if (key === 'style') {
          value.value = value.value.replace(/display:\s*none[^;]*/, '');
        }
        if (!_.isEmpty(key) && key !== 'undefined' && value && !_.isEmpty(value.value) && value !== 'undefined') {
          node.setAttribute(key, value.value);
        }
      }
      svg = new xmldom.XMLSerializer().serializeToString(node);
      sprite = new SVGImage(null, {
        content: svg,
        defaults: this.options.defaults
      });
      return this.sprites[id] = sprite;
    }

    _addColor(type, attributes, node) {
      var base, color, key, selectors, typeSelector;
      try {
        color = attributes[type].value === 'none' ? Color('rgba(255, 255, 255, 0)') : Color(attributes[type].value);
        typeSelector = `[${type}]`;
        key = color.rgbaString();
        (base = this.colors)[key] || (base[key] = {
          color: color,
          count: 0,
          index: Object.keys(this.colors).length,
          selectors: []
        });
        this.colors[key].count++;
        this.colors[key].selectors.push(`${attributes.path}${typeSelector}`);
        selectors = [`color${this.colorCount++ || '0'}`];
        if (attributes.id) {
          selectors.push(`#${attributes.id.value}${typeSelector}`);
        }
        selectors.push(`colorGroup${this.colors[key].index || '0'}`);
        if (attributes.class) {
          selectors.push(`.${attributes.class.value}${typeSelector}`);
        }
        selectors.push(`${node.tagName}[${type}]`);
        selectors.push(typeSelector);
        selectors.push("[color]");
        selectors = _.map(selectors, function(selector) {
          return `it[\'${selector}\']`;
        });
        return node.attributes[attributes[type].index].value = `{{= ${selectors.join(' || ')} || \'${attributes[type].value}\'}}`;
      } catch (error) {

      }
    }

  };

  module.exports = SVGImage;

}).call(this);
