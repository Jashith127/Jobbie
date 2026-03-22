"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var axios_1 = require("axios");
var cheerio = require("cheerio");
function debugIndeed() {
    return __awaiter(this, void 0, void 0, function () {
        var keywords, location_1, searchUrl, response, $, method1, method2, method3, method4, method5, firstCard, titleVariations, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    keywords = 'developer';
                    location_1 = 'United States';
                    searchUrl = "https://www.indeed.com/jobs?q=".concat(encodeURIComponent(keywords), "&l=").concat(encodeURIComponent(location_1), "&radius=25");
                    console.log("Fetching: ".concat(searchUrl));
                    return [4 /*yield*/, axios_1.default.get(searchUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            },
                            timeout: 15000,
                        })];
                case 1:
                    response = _b.sent();
                    $ = cheerio.load(response.data);
                    // Try multiple selector approaches
                    console.log('\n=== DEBUGGING INDEED SELECTORS ===\n');
                    // Method 1: data-job-id
                    console.log('1. Looking for [data-job-id]:');
                    method1 = $('div[data-job-id]').length;
                    console.log("   Found: ".concat(method1, " elements"));
                    // Method 2: job-tile
                    console.log('2. Looking for [data-testid="jobMetaDataGroup"]:');
                    method2 = $('[data-testid="jobMetaDataGroup"]').length;
                    console.log("   Found: ".concat(method2, " elements"));
                    // Method 3: Look for job card patterns
                    console.log('3. Looking for .jobCard:');
                    method3 = $('.jobCard').length;
                    console.log("   Found: ".concat(method3, " elements"));
                    // Method 4: Article elements (common for job listings)
                    console.log('4. Looking for article element:');
                    method4 = $('article').length;
                    console.log("   Found: ".concat(method4, " elements"));
                    // Method 5: Look at divs with aria-label
                    console.log('5. Looking for [aria-label*="job"]:');
                    method5 = $('div[aria-label*="job"]').length;
                    console.log("   Found: ".concat(method5, " elements"));
                    // Print first few job card classes/ids
                    console.log('\n=== ANALYZING FIRST CARD ===\n');
                    firstCard = null;
                    if (method1 > 0) {
                        firstCard = $('div[data-job-id]').first();
                        console.log('Using method 1 selector');
                    }
                    else if (method4 > 0) {
                        firstCard = $('article').first();
                        console.log('Using article selector');
                    }
                    if (firstCard && firstCard.length) {
                        console.log('Card HTML:');
                        console.log((_a = firstCard.html()) === null || _a === void 0 ? void 0 : _a.substring(0, 500));
                        console.log('...\n');
                        // Try to extract title
                        console.log('Trying title extraction:');
                        titleVariations = [
                            firstCard.find('h2 a[data-jk]').attr('title'),
                            firstCard.find('h2.jobTitle span').text(),
                            firstCard.find('.jobTitle').text(),
                            firstCard.find('a[role="link"]').attr('aria-label'),
                            firstCard.find('a').first().attr('aria-label'),
                        ];
                        titleVariations.forEach(function (title, idx) {
                            if (title)
                                console.log("  [".concat(idx, "] Found: \"").concat(title.substring(0, 50), "\""));
                        });
                    }
                    console.log('\n=== PAGE STRUCTURE ===\n');
                    console.log("Total HTML length: ".concat(response.data.length));
                    console.log("Page contains \"jobTitle\": ".concat(response.data.includes('jobTitle')));
                    console.log("Page contains \"data-job-id\": ".concat(response.data.includes('data-job-id')));
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _b.sent();
                    console.error('Error:', error_1.message);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
debugIndeed();
