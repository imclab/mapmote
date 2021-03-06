(function() {
    var SphericalMercator = (function(){

    // Closures including constants and other precalculated values.
    var cache = {},
        EPSLN = 1.0e-10,
        D2R = Math.PI / 180,
        R2D = 180 / Math.PI,
        // 900913 properties.
        A = 6378137,
        MAXEXTENT = 20037508.34;


    // SphericalMercator constructor: precaches calculations
    // for fast tile lookups.
    function SphericalMercator(options) {
        options = options || {};
        this.size = options.size || 256;
        if (!cache[this.size]) {
            var size = this.size;
            var c = cache[this.size] = {};
            c.Bc = [];
            c.Cc = [];
            c.zc = [];
            c.Ac = [];
            for (var d = 0; d < 30; d++) {
                c.Bc.push(size / 360);
                c.Cc.push(size / (2 * Math.PI));
                c.zc.push(size / 2);
                c.Ac.push(size);
                size *= 2;
            }
        }
        this.Bc = cache[this.size].Bc;
        this.Cc = cache[this.size].Cc;
        this.zc = cache[this.size].zc;
        this.Ac = cache[this.size].Ac;
    }

    // Convert lon lat to screen pixel value
    //
    // - `ll` {Array} `[lon, lat]` array of geographic coordinates.
    // - `zoom` {Number} zoom level.
    SphericalMercator.prototype.px = function(ll, zoom) {
        var d = this.zc[zoom];
        var f = Math.min(Math.max(Math.sin(D2R * ll[1]), -0.9999), 0.9999);
        var x = Math.round(d + ll[0] * this.Bc[zoom]);
        var y = Math.round(d + 0.5 * Math.log((1 + f) / (1 - f)) * (-this.Cc[zoom]));
        (x > this.Ac[zoom]) && (x = this.Ac[zoom]);
        (y > this.Ac[zoom]) && (y = this.Ac[zoom]);
        //(x < 0) && (x = 0);
        //(y < 0) && (y = 0);
        return [x, y];
    };

    // Convert screen pixel value to lon lat
    //
    // - `px` {Array} `[x, y]` array of geographic coordinates.
    // - `zoom` {Number} zoom level.
    SphericalMercator.prototype.ll = function(px, zoom) {
        var g = (px[1] - this.zc[zoom]) / (-this.Cc[zoom]);
        var lon = (px[0] - this.zc[zoom]) / this.Bc[zoom];
        var lat = R2D * (2 * Math.atan(Math.exp(g)) - 0.5 * Math.PI);
        return [lon, lat];
    };

    // Convert tile xyz value to bbox of the form `[w, s, e, n]`
    //
    // - `x` {Number} x (longitude) number.
    // - `y` {Number} y (latitude) number.
    // - `zoom` {Number} zoom.
    // - `tms_style` {Boolean} whether to compute using tms-style.
    // - `srs` {String} projection for resulting bbox (WGS84|900913).
    // - `return` {Array} bbox array of values in form `[w, s, e, n]`.
    SphericalMercator.prototype.bbox = function(x, y, zoom, tms_style, srs) {
        // Convert xyz into bbox with srs WGS84
        if (tms_style) {
            y = (Math.pow(2, zoom) - 1) - y;
        }
        // Use +y to make sure it's a number to avoid inadvertent concatenation.
        var ll = [x * this.size, (+y + 1) * this.size]; // lower left
        // Use +x to make sure it's a number to avoid inadvertent concatenation.
        var ur = [(+x + 1) * this.size, y * this.size]; // upper right
        var bbox = this.ll(ll, zoom).concat(this.ll(ur, zoom));

        // If web mercator requested reproject to 900913.
        if (srs === '900913') {
            return this.convert(bbox, '900913');
        } else {
            return bbox;
        }
    };

    // Convert bbox to xyx bounds
    //
    // - `bbox` {Number} bbox in the form `[w, s, e, n]`.
    // - `zoom` {Number} zoom.
    // - `tms_style` {Boolean} whether to compute using tms-style.
    // - `srs` {String} projection of input bbox (WGS84|900913).
    // - `@return` {Object} XYZ bounds containing minX, maxX, minY, maxY properties.
    SphericalMercator.prototype.xyz = function(bbox, zoom, tms_style, srs) {
        // If web mercator provided reproject to WGS84.
        if (srs === '900913') {
            bbox = this.convert(bbox, 'WGS84');
        }

        var ll = [bbox[0], bbox[1]]; // lower left
        var ur = [bbox[2], bbox[3]]; // upper right
        var px_ll = this.px(ll, zoom);
        var px_ur = this.px(ur, zoom);
        // Y = 0 for XYZ is the top hence minY uses px_ur[1].
        var bounds = {
            minX: Math.floor(px_ll[0] / this.size),
            minY: Math.floor(px_ur[1] / this.size),
            maxX: Math.floor((px_ur[0] - 1) / this.size),
            maxY: Math.floor((px_ll[1] - 1) / this.size)
        };
        if (tms_style) {
            var tms = {
                minY: (Math.pow(2, zoom) - 1) - bounds.maxY,
                maxY: (Math.pow(2, zoom) - 1) - bounds.minY
            };
            bounds.minY = tms.minY;
            bounds.maxY = tms.maxY;
        }
        return bounds;
    };

    // Convert projection of given bbox.
    //
    // - `bbox` {Number} bbox in the form `[w, s, e, n]`.
    // - `to` {String} projection of output bbox (WGS84|900913). Input bbox
    //   assumed to be the "other" projection.
    // - `@return` {Object} bbox with reprojected coordinates.
    SphericalMercator.prototype.convert = function(bbox, to) {
        if (to === '900913') {
            return this.forward(bbox.slice(0, 2)).concat(this.forward(bbox.slice(2,4)));
        } else {
            return this.inverse(bbox.slice(0, 2)).concat(this.inverse(bbox.slice(2,4)));
        }
    };

    // Convert lon/lat values to 900913 x/y.
    SphericalMercator.prototype.forward = function(ll) {
        var xy = [
            A * ll[0] * D2R,
            A * Math.log(Math.tan((Math.PI*0.25) + (0.5 * ll[1] * D2R)))
        ];
        // if xy value is beyond maxextent (e.g. poles), return maxextent.
        (xy[0] > MAXEXTENT) && (xy[0] = MAXEXTENT);
        (xy[0] < -MAXEXTENT) && (xy[0] = -MAXEXTENT);
        (xy[1] > MAXEXTENT) && (xy[1] = MAXEXTENT);
        (xy[1] < -MAXEXTENT) && (xy[1] = -MAXEXTENT);
        return xy;
    };

    // Convert 900913 x/y values to lon/lat.
    SphericalMercator.prototype.inverse = function(xy) {
        return [
            (xy[0] * R2D / A),
            ((Math.PI*0.5) - 2.0 * Math.atan(Math.exp(-xy[1] / A))) * R2D
        ];
    };

    return SphericalMercator;

    })();

    if (typeof module !== 'undefined' && typeof exports !== 'undefined') {
        module.exports = exports = SphericalMercator;
    }



    function guessTiles() {
        var tile_images;

        tile_images = document.getElementsByClassName('map-tile-loaded');
        if (!tile_images.length) {
        tile_images = document.getElementsByClassName('leaflet-tile');
        if (!tile_images.length) {
        tile_images = document.getElementsByClassName('olTileImage');
        if (!tile_images.length) {
        tile_images = document.getElementsByTagName('img');
        }}}

        if (!tile_images.length) return alert('No images found on this page');
        var coordinates = [];
        for (var i = 0; i < tile_images.length; i++) {
            var img = tile_images[i];
            if (img.getAttribute('src')) {
                var coord = [];
                console.log(img.getAttribute('src'));
                coord = img.getAttribute('src').match(/(\d+)\/(\d+)\/(\d+)/);
                if (!coord || !coord.length) {
                // google.
                var s = img.getAttribute('src');
                var x = s.match(/x=(\d+)/),
                    y = s.match(/y=(\d+)/),
                    z = s.match(/z=(\d+)/);
                if (x && y && z) coord = [0, z[1], x[1], y[1]];
                }
                if (coord && coord.length) coordinates.push({
                    z: +coord[1],
                    x: +coord[2],
                    y: +coord[3]
                });
            }
        }

        if (!coordinates.length) return alert('No tiles found on this page');
        if (coordinates.length) coordsToLL(coordinates);
    }

    function union(cs) {
        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (var i = 0; i < cs.length; i++) {
            if (cs[i][0] < minx) minx = cs[i][0];
            if (cs[i][1] < miny) miny = cs[i][1];
            if (cs[i][2] > maxx) maxx = cs[i][2];
            if (cs[i][3] > maxy) maxy = cs[i][3];
        }
        return [minx, miny, maxx, maxy];
    }

    function loadZoom(bb) {
        var ifr = document.body.appendChild(document.createElement('iframe'));
        ifr.style.width = '0px';
        ifr.style.height = '0px';
        var p = 12;

        if ((bb[2] - bb[0]) > 0.01) {
            var c = (bb[0] + bb[2]) / 2;
            bb[0] = c - 0.005;
            bb[2] = c + 0.005;
        }

        if ((bb[3] - bb[1]) > 0.01) {
            var d = (bb[3] + bb[1]) / 2;
            bb[1] = d - 0.005;
            bb[3] = d + 0.005;
        }

        ifr.setAttribute('src',
            'http://127.0.0.1:8111/load_and_zoom' +
            '?left=' + bb[0].toFixed(p) +
            '&top=' + bb[3].toFixed(p) +
            '&right=' + bb[2].toFixed(p) +
            '&bottom=' + bb[1].toFixed(p));
    }

    function coordsToLL(cs) {
        var s = new SphericalMercator();
        var zoom = cs[0].z;

        var bboxes = [];
        for (var i = 0; i < cs.length; i++) {
            if (cs[i].z !== zoom) continue;
            bboxes.push(s.bbox(cs[i].x, cs[i].y, cs[i].z));
        }

        if (bboxes.length) loadZoom(union(bboxes));
    }

    guessTiles();
})();
