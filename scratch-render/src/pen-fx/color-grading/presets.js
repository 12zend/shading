// Easy color grading presets. Values use editor-style units: most sliders are -100..100 percentages,
// exposure is in EV, hue values are degrees, radii are pixels at 720p and colors are hex strings.
// Wheel offsets are RGB percentages added in the shadow, midtone and highlight zones.

const CATEGORIES = [
    {id: 'classic', name: 'Classic'},
    {id: 'film', name: 'Film'},
    {id: 'anime', name: 'Anime'},
    {id: 'cine', name: 'Cine'},
    {id: 'portrait', name: 'Portrait'},
    {id: 'nature', name: 'Nature'},
    {id: 'street', name: 'Street & Neon'},
    {id: 'retro', name: 'Retro Decades'},
    {id: 'mood', name: 'Mood & Genre'},
    {id: 'mono', name: 'Mono & Duo'}
];

const presetId = name => String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const definitions = {
    classic: [
        ['Teal&Orange', {
            primary: {contrast: 15, saturation: 5, temperature: 4},
            wheels: {shadows: [-3, 1, 5], highlights: [4, 1, -3]},
            curve: [2, 24, 50, 77, 98],
            mojo: {amount: 60, protect: 70}
        }],
        ['Golden Hour', {
            primary: {temperature: 35, tint: 5, exposure: 0.15, highlights: -10, shadows: 10, vibrance: 20},
            wheels: {midtones: [2, 1, -2], highlights: [6, 3, -4]},
            halation: {amount: 25, threshold: 70, radius: 18, color: '#ff8040'},
            diffuse: {amount: 15, radius: 12},
            vignette: {amount: -20}
        }],
        ['Bleach', {
            primary: {contrast: 20, saturation: -25},
            filmLut: {stock: 'bleach', amount: 80},
            sharpen: {amount: 30}
        }],
        ['Vintage Fade', {
            primary: {contrast: -15, saturation: -20, temperature: 10, outputBlack: 8, outputWhite: 94},
            wheels: {shadows: [2, 1, -2], highlights: [3, 2, -2]},
            curve: [8, 28, 50, 72, 93],
            grain: {amount: 20, size: 1.5},
            vignette: {amount: -25}
        }],
        ['Noir B&W', {
            primary: {saturation: -100, contrast: 40, blacks: -15},
            filmLut: {stock: 'mono', amount: 60},
            grain: {amount: 25},
            vignette: {amount: -40}
        }],
        ['Neon Night', {
            primary: {temperature: -20, tint: 15, saturation: 25, vibrance: 20, contrast: 20},
            wheels: {shadows: [0, -2, 8], highlights: [5, -2, 6]},
            halation: {amount: 30, threshold: 60, radius: 20, color: '#ff3cc8'},
            diffuse: {amount: 20, radius: 14}
        }],
        ['Sunny Pop', {
            primary: {exposure: 0.2,
                contrast: 15,
                vibrance: 35,
                saturation: 10,
                temperature: 10,
                highlights: -10,
                shadows: 15}
        }],
        ['Cold Thriller', {
            primary: {temperature: -35, tint: -8, saturation: -25, contrast: 20},
            wheels: {shadows: [-2, 2, 5], highlights: [-1, 2, 3]},
            filmLut: {stock: 'cine', amount: 40},
            vignette: {amount: -30}
        }],
        ['Pastel Dream', {
            primary: {exposure: 0.35, contrast: -30, saturation: -15, highlights: -15, outputBlack: 10},
            wheels: {shadows: [4, 1, 5], highlights: [3, 1, 2]},
            curve: [10, 32, 55, 78, 96],
            diffuse: {amount: 35, radius: 16}
        }],
        ['Sepia', {
            primary: {contrast: 5},
            colorRemap: {shadow: '#2b1a0c', mid: '#9a6b3e', highlight: '#f3e2c2', amount: 90},
            grain: {amount: 15},
            vignette: {amount: -20}
        }],
        ['Matrix Green', {
            primary: {tint: -40, temperature: -10, saturation: -20, contrast: 25},
            wheels: {shadows: [-3, 4, -2], midtones: [-2, 5, -2], highlights: [-1, 4, -1]},
            sharpen: {amount: 20}
        }],
        ['Horror Cold', {
            primary: {temperature: -40, saturation: -45, contrast: 30, blacks: -20, exposure: -0.3},
            wheels: {shadows: [-2, 3, 4]},
            hslKey: {hue: 0, width: 30, softness: 20, outside: 40},
            grain: {amount: 25},
            vignette: {amount: -55}
        }],
        ['Day f. Night', {
            primary: {exposure: -1.4, temperature: -45, saturation: -40, contrast: 10, highlights: -30},
            wheels: {shadows: [-2, 0, 6], midtones: [-2, 0, 5]},
            vignette: {amount: -35}
        }],
        ['Print Warm', {
            primary: {temperature: 10, contrast: 5},
            filmLut: {stock: 'print', amount: 70}
        }],
        ['Dreamy Bloom', {
            primary: {exposure: 0.2, contrast: -15, saturation: -5, highlights: -10},
            wheels: {highlights: [3, 1, 3]},
            diffuse: {amount: 55, radius: 22},
            halation: {amount: 20, threshold: 65, radius: 22, color: '#ffd0c0'}
        }],
        ['Punchy', {
            primary: {contrast: 35, vibrance: 30, saturation: 15, blacks: -10, whites: 10},
            sharpen: {amount: 35},
            vignette: {amount: -15}
        }]
    ],
    film: [
        ['Warm Print', {
            primary: {temperature: 6},
            filmLut: {stock: 'print', amount: 100},
            grain: {amount: 15},
            halation: {amount: 15, threshold: 72, radius: 14, color: '#ff6030'}
        }],
        ['Cool Neg 400', {
            primary: {temperature: -10, exposure: 0.15},
            filmLut: {stock: 'negative', amount: 100},
            grain: {amount: 25, size: 1.6}
        }],
        ['Slide 50', {
            primary: {contrast: 10, saturation: 10},
            filmLut: {stock: 'slide', amount: 90},
            grain: {amount: 8},
            vignette: {amount: -15}
        }],
        ['Faded Rev.', {
            primary: {contrast: -10, outputBlack: 12, outputWhite: 92},
            wheels: {shadows: [-2, 2, 5], highlights: [3, -1, 2]},
            filmLut: {stock: 'slide', amount: 50},
            grain: {amount: 20}
        }],
        ['Cine Teal', {
            primary: {contrast: 10},
            filmLut: {stock: 'cine', amount: 100},
            mojo: {amount: 40, protect: 80},
            halation: {amount: 12, threshold: 75, radius: 14, color: '#ff5a2a'}
        }],
        ['Silver Mono', {
            primary: {contrast: 15},
            filmLut: {stock: 'mono', amount: 100},
            grain: {amount: 30},
            sharpen: {amount: 15},
            vignette: {amount: -20}
        }],
        ['Bleached Ag', {
            primary: {contrast: 15, temperature: -10, saturation: -10},
            filmLut: {stock: 'bleach', amount: 100},
            grain: {amount: 20}
        }],
        ['Pastel Print', {
            primary: {exposure: 0.3, contrast: -20, saturation: -10, outputBlack: 6},
            wheels: {highlights: [3, 0, 2]},
            filmLut: {stock: 'negative', amount: 70}
        }]
    ],
    anime: [
        ['Vivid', {
            primary: {vibrance: 45, saturation: 20, contrast: 15, whites: 10},
            sharpen: {amount: 25}
        }],
        ['Sunset Glow', {
            primary: {temperature: 30, tint: 12},
            wheels: {shadows: [1, -1, 4], midtones: [3, 0, 1], highlights: [7, 2, -2]},
            halation: {amount: 30, threshold: 60, radius: 18, color: '#ff7050'},
            diffuse: {amount: 20, radius: 14}
        }],
        ['Cel Pastel', {
            primary: {exposure: 0.2, contrast: -10, saturation: -10, vibrance: 15, outputBlack: 6},
            wheels: {shadows: [2, 1, 5]},
            posterize: {levels: 10, amount: 30}
        }],
        ['City Pop 84', {
            primary: {temperature: -5, tint: 18, saturation: 20, contrast: 5},
            wheels: {shadows: [2, -2, 8], highlights: [6, 2, 0]},
            curve: [6, 27, 51, 76, 98],
            diffuse: {amount: 25, radius: 14},
            halation: {amount: 20, threshold: 65, radius: 16, color: '#ff60a0'},
            grain: {amount: 10}
        }],
        ['Vaporwave', {
            primary: {tint: 30, temperature: -15, saturation: 20},
            colorRemap: {shadow: '#2a1b5e', mid: '#e056b0', highlight: '#7de8ff', amount: 35},
            rgbSpectrum: {amount: 20},
            grain: {amount: 10}
        }],
        ['Cyber Lime', {
            primary: {tint: -25, temperature: -5, saturation: 20, contrast: 20},
            wheels: {shadows: [-2, 1, 5], highlights: [2, 6, -4]},
            hueCurves: {hue: [0, 15, 0, 0, 0, 0]},
            halation: {amount: 20, threshold: 65, radius: 16, color: '#b0ff40'}
        }],
        ['Manga Tone', {
            primary: {saturation: -100, contrast: 60, whites: 20, blacks: -25},
            posterize: {levels: 4, amount: 60},
            sharpen: {amount: 40},
            grain: {amount: 10, size: 2}
        }],
        ['Retro OVA', {
            primary: {saturation: -5, contrast: -10, outputBlack: 7},
            wheels: {shadows: [2, 0, 5]},
            filmLut: {stock: 'negative', amount: 40},
            grain: {amount: 25, size: 1.8},
            rgbSpectrum: {amount: 15},
            diffuse: {amount: 20, radius: 12},
            filmBreath: {amount: 30, speed: 1},
            vignette: {amount: -25}
        }],
        ['Idol Stage', {
            primary: {exposure: 0.25, vibrance: 25, tint: 10, highlightBoost: 30},
            diffuse: {amount: 35, radius: 16},
            halation: {amount: 35, threshold: 60, radius: 20, color: '#ff90d0'}
        }],
        ['Dark Fantasy', {
            primary: {exposure: -0.4, contrast: 25, saturation: -15},
            wheels: {shadows: [1, -1, 6], midtones: [2, -1, 4], highlights: [4, 2, 0]},
            halation: {amount: 15, threshold: 70, radius: 18, color: '#a060ff'},
            vignette: {amount: -45}
        }]
    ],
    cine: [
        ['K-Drama', {
            primary: {exposure: 0.2,
                contrast: -10,
                saturation: -8,
                highlights: -20,
                shadows: 15,
                temperature: -5,
                tint: 4},
            wheels: {highlights: [2, 1, 2]},
            hueCurves: {saturation: [0, 0, -25, 0, 0, 0]},
            diffuse: {amount: 25, radius: 14}
        }],
        ['MV Punch', {
            primary: {contrast: 35, saturation: 20, vibrance: 20},
            mojo: {amount: 50, protect: 70},
            sharpen: {amount: 30},
            rgbSpectrum: {amount: 10},
            vignette: {amount: -25}
        }],
        ['Documentary', {
            primary: {contrast: 10, saturation: -10, vibrance: 10, highlights: -15, shadows: 10, temperature: 3},
            grain: {amount: 10}
        }],
        ['Blockbuster', {
            primary: {contrast: 25, blacks: -10, highlights: -15},
            mojo: {amount: 80, protect: 75},
            filmLut: {stock: 'cine', amount: 30},
            sharpen: {amount: 20},
            vignette: {amount: -20}
        }],
        ['Nordic Chill', {
            primary: {temperature: -25, saturation: -30, exposure: 0.15, contrast: 5, highlights: -10},
            wheels: {shadows: [-1, 1, 4]},
            hueCurves: {saturation: [0, -20, -35, 0, 0, 0]}
        }],
        ['Wedding', {
            primary: {exposure: 0.3,
                contrast: -10,
                highlights: -25,
                temperature: 8,
                tint: 5,
                saturation: -5,
                outputBlack: 4},
            wheels: {highlights: [3, 1, 0]},
            diffuse: {amount: 30, radius: 16}
        }],
        ['Urban Night', {
            primary: {temperature: -20, contrast: 25, saturation: -10},
            wheels: {shadows: [-3, 1, 5], highlights: [6, 2, -4]},
            halation: {amount: 25, threshold: 65, radius: 18, color: '#ff8830'},
            grain: {amount: 15},
            vignette: {amount: -30}
        }],
        ['Desert Heat', {
            primary: {temperature: 40, tint: 8, contrast: 20, saturation: -5, highlights: -15},
            wheels: {shadows: [2, 0, -2], highlights: [6, 3, -5]},
            filmLut: {stock: 'print', amount: 30},
            halation: {amount: 10, threshold: 70, radius: 14, color: '#ff7a30'}
        }],
        ['Rainy Blue', {
            primary: {temperature: -30, saturation: -30, exposure: -0.15, contrast: -5},
            wheels: {shadows: [-2, 1, 5], midtones: [-1, 1, 3]},
            diffuse: {amount: 20, radius: 14},
            vignette: {amount: -20}
        }],
        ['Emerald&Gold', {
            primary: {contrast: 20, saturation: 10},
            wheels: {shadows: [-3, 3, 1], highlights: [6, 3, -4]},
            hueCurves: {hue: [0, -8, 10, 0, 0, 0], saturation: [0, 20, 25, 0, 0, 0]},
            hslSecondary: {hue: 130, width: 60, softness: 30, saturation: 20}
        }]
    ],
    portrait: [
        ['Soft Skin', {
            primary: {exposure: 0.15, contrast: -10, highlights: -10},
            hslSecondary: {hue: 25, width: 40, softness: 20, saturation: -10, lightness: 8},
            diffuse: {amount: 30, radius: 12}
        }],
        ['Peach Cream', {
            primary: {temperature: 15, tint: 10, exposure: 0.2, contrast: -10, outputBlack: 4},
            wheels: {highlights: [5, 3, 1]},
            hslSecondary: {hue: 25, width: 40, softness: 20, saturation: 5, lightness: 6}
        }],
        ['Porcelain', {
            primary: {exposure: 0.3, saturation: -20, temperature: -8, highlights: -20, whites: 10},
            hslSecondary: {hue: 25, width: 45, softness: 20, saturation: -30, lightness: 10},
            diffuse: {amount: 20, radius: 12}
        }],
        ['Golden Portrait', {
            primary: {temperature: 25, contrast: 10, vibrance: 10},
            wheels: {midtones: [3, 1, -2], highlights: [6, 3, -3]},
            halation: {amount: 15, threshold: 70, radius: 16, color: '#ffa040'}
        }],
        ['Moody', {
            primary: {exposure: -0.3, contrast: 20, saturation: -25, blacks: -15, highlights: -20},
            wheels: {shadows: [0, 1, 3]},
            mojo: {amount: 20, protect: 100},
            vignette: {amount: -40}
        }],
        ['Editorial Matte', {
            primary: {contrast: 10, saturation: -15, outputBlack: 10, outputWhite: 95},
            curve: [8, 26, 50, 76, 95],
            sharpen: {amount: 20}
        }],
        ['Rosy Blush', {
            primary: {tint: 15, temperature: 5, exposure: 0.15},
            wheels: {highlights: [4, 0, 2]},
            hslSecondary: {hue: 350, width: 50, softness: 25, saturation: 20, lightness: 5},
            diffuse: {amount: 15, radius: 12}
        }],
        ['Bronze Tan', {
            primary: {temperature: 20, tint: 5, contrast: 20},
            wheels: {shadows: [3, 1, -2]},
            hslSecondary: {hue: 25, width: 40, softness: 20, shift: -5, saturation: 20, lightness: -8}
        }],
        ['Clean Studio', {
            primary: {exposure: 0.1, contrast: 10, whites: 15, blacks: -5, vibrance: 10, temperature: -3},
            sharpen: {amount: 25}
        }],
        ['Boudoir Warm', {
            primary: {temperature: 30, tint: 10, exposure: -0.1, contrast: 5, saturation: -5},
            diffuse: {amount: 35, radius: 16},
            halation: {amount: 20, threshold: 65, radius: 18, color: '#ff7050'},
            vignette: {amount: -35}
        }]
    ],
    nature: [
        ['Alpine Crisp', {
            primary: {temperature: -10, contrast: 20, vibrance: 25, highlights: -20, whites: 10},
            hueCurves: {saturation: [0, 0, 0, 15, 20, 0]},
            sharpen: {amount: 30}
        }],
        ['Forest Emerald', {
            primary: {contrast: 15},
            wheels: {shadows: [-2, 2, 1]},
            hueCurves: {hue: [0, 10, 8, 0, 0, 0], saturation: [0, 10, 25, 0, 0, 0], luminance: [0, 0, -10, 0, 0, 0]}
        }],
        ['Autumn Rust', {
            primary: {temperature: 20, contrast: 15},
            hueCurves: {hue: [0, -12, -25, 0, 0, 0], saturation: [25, 25, 0, 0, 0, 0]},
            filmLut: {stock: 'print', amount: 30}
        }],
        ['Ocean Azure', {
            primary: {temperature: -15, contrast: 10, vibrance: 15},
            hueCurves: {hue: [0, 0, 0, 8, 0, 0], saturation: [0, 0, 0, 25, 30, 0]}
        }],
        ['Tropic Punch', {
            primary: {vibrance: 40, saturation: 20, temperature: 10, contrast: 20},
            hueCurves: {saturation: [0, 0, 20, 30, 0, 0]},
            mojo: {amount: 20, protect: 70}
        }],
        ['Misty Morning', {
            primary: {exposure: 0.3,
                contrast: -30,
                saturation: -25,
                temperature: -8,
                outputBlack: 12,
                highlights: -10},
            diffuse: {amount: 45, radius: 24}
        }],
        ['Arctic Blue', {
            primary: {temperature: -45, exposure: 0.25, saturation: -20, whites: 15},
            wheels: {shadows: [-2, 1, 6], highlights: [-1, 1, 3]}
        }],
        ['Lush Meadow', {
            primary: {vibrance: 20, temperature: 5, contrast: 10},
            hueCurves: {hue: [0, 10, 0, 0, 0, 0], saturation: [0, 0, 30, 0, 0, 0], luminance: [0, 0, 5, 0, 0, 0]}
        }],
        ['Stormy Sky', {
            primary: {exposure: -0.2, contrast: 30, saturation: -35, highlights: -35, blacks: -15, temperature: -15},
            wheels: {shadows: [-1, 1, 4]},
            vignette: {amount: -35}
        }],
        ['Sakura', {
            primary: {tint: 15, temperature: 3, exposure: 0.25, contrast: -10},
            wheels: {highlights: [4, 1, 3]},
            hueCurves: {hue: [-8, 0, 0, 0, 0, 0]},
            hslSecondary: {hue: 330, width: 60, softness: 25, saturation: 25, lightness: 5},
            diffuse: {amount: 25, radius: 14}
        }]
    ],
    street: [
        ['Tokyo Neon', {
            primary: {temperature: -15, tint: 20, saturation: 25, contrast: 25},
            wheels: {shadows: [0, -2, 8]},
            halation: {amount: 35, threshold: 60, radius: 20, color: '#ff40a0'},
            diffuse: {amount: 20, radius: 14}
        }],
        ['HK Haze', {
            primary: {temperature: 5, tint: -15, saturation: -10, outputBlack: 8},
            wheels: {shadows: [-2, 4, 2], highlights: [6, 4, -2]},
            diffuse: {amount: 40, radius: 18},
            halation: {amount: 20, threshold: 65, radius: 18, color: '#ff9040'},
            grain: {amount: 15}
        }],
        ['Cyberpunk', {
            primary: {tint: 35, temperature: -25, contrast: 25},
            colorRemap: {shadow: '#1a0838', mid: '#c0309a', highlight: '#40f0ff', amount: 30},
            rgbSpectrum: {amount: 25},
            halation: {amount: 30, threshold: 60, radius: 20, color: '#ff30d0'}
        }],
        ['Midnight Diner', {
            primary: {temperature: 15, tint: -10, exposure: -0.2, contrast: 15},
            wheels: {shadows: [-3, 2, 4], highlights: [6, 3, -3]},
            halation: {amount: 25, threshold: 65, radius: 18, color: '#ff9a40'},
            grain: {amount: 15},
            vignette: {amount: -30}
        }],
        ['Rainy Asphalt', {
            primary: {temperature: -20, saturation: -15, contrast: 25, blacks: -10},
            wheels: {highlights: [5, 2, -2]},
            halation: {amount: 25, threshold: 65, radius: 18, color: '#ffb060'},
            diffuse: {amount: 25, radius: 14},
            sharpen: {amount: 20}
        }],
        ['Arcade Glow', {
            primary: {saturation: 30, vibrance: 20, contrast: 20, tint: 12},
            halation: {amount: 40, threshold: 55, radius: 20, color: '#ff50ff'},
            diffuse: {amount: 30, radius: 16},
            rgbSpectrum: {amount: 15}
        }],
        ['Vapor City', {
            primary: {tint: 18, contrast: -5, outputBlack: 8},
            colorRemap: {shadow: '#2d1f5a', mid: '#b35fa8', highlight: '#ffd3e8', amount: 30},
            diffuse: {amount: 25, radius: 14}
        }],
        ['Downtown Amber', {
            primary: {temperature: 30, contrast: 20, saturation: -5},
            wheels: {shadows: [-2, 1, 3], highlights: [7, 3, -5]},
            halation: {amount: 25, threshold: 65, radius: 18, color: '#ff9030'}
        }],
        ['Noir Alley', {
            primary: {contrast: 45, blacks: -20, temperature: -10},
            hslKey: {hue: 0, width: 30, softness: 20, outside: 0},
            grain: {amount: 30},
            vignette: {amount: -50}
        }],
        ['Chrome Subway', {
            primary: {temperature: -15, tint: -10, saturation: -35, contrast: 30, whites: 10},
            wheels: {shadows: [-2, 2, 3]},
            sharpen: {amount: 35}
        }]
    ],
    retro: [
        ['70s Bronze', {
            primary: {temperature: 25, tint: 5, contrast: -5, saturation: -10, outputBlack: 8},
            wheels: {shadows: [3, 1, -2], highlights: [5, 3, -4]},
            filmLut: {stock: 'print', amount: 50},
            grain: {amount: 25},
            vignette: {amount: -20}
        }],
        ['80s VHS', {
            primary: {saturation: 15, contrast: 10, tint: 5, outputBlack: 6},
            rgbSpectrum: {amount: 35},
            grain: {amount: 25, color: 50},
            sharpen: {amount: 40, radius: 2},
            diffuse: {amount: 20, radius: 10},
            filmBreath: {amount: 25, speed: 1.5}
        }],
        ['90s Camcorder', {
            primary: {temperature: -5, tint: -5, saturation: -10, contrast: 10, outputBlack: 4},
            sharpen: {amount: 50},
            grain: {amount: 20, color: 40},
            rgbSpectrum: {amount: 15}
        }],
        ['Polaroid', {
            primary: {temperature: 8, contrast: -10, outputBlack: 10, outputWhite: 94},
            wheels: {shadows: [-1, 2, 4], highlights: [4, 2, -2]},
            filmLut: {stock: 'negative', amount: 50},
            vignette: {amount: -30}
        }],
        ['Super 8', {
            primary: {temperature: 12},
            filmLut: {stock: 'print', amount: 70},
            grain: {amount: 55, size: 2.2},
            filmBreath: {amount: 60, speed: 1},
            halation: {amount: 20, threshold: 68, radius: 16, color: '#ff6030'},
            lensDistortion: {amount: -15},
            vignette: {amount: -45}
        }],
        ['Techni 2-Strip', {
            primary: {saturation: 10, contrast: 15},
            mixer: {red: [90, 10, 0], green: [40, 55, 5], blue: [30, 60, 10]}
        }],
        ['Techni 3-Strip', {
            primary: {saturation: 35, contrast: 25, blacks: -10},
            mixer: {red: [110, -10, 0], green: [-5, 110, -5], blue: [-5, -15, 120]}
        }],
        ['Cross Process', {
            primary: {contrast: 30, saturation: 20, tint: -10},
            wheels: {shadows: [0, -3, 8], highlights: [3, 5, -8]}
        }],
        ['Disco Glam', {
            primary: {saturation: 20, tint: 10, temperature: 15, highlightBoost: 30},
            halation: {amount: 45, threshold: 60, radius: 20, color: '#ffb050'},
            diffuse: {amount: 30, radius: 16},
            vignette: {amount: -25}
        }],
        ['Y2K Flash', {
            primary: {exposure: 0.35, whites: 20, contrast: 25, temperature: -12, saturation: 10, highlightBoost: 40},
            sharpen: {amount: 20},
            vignette: {amount: -30, midpoint: 45}
        }]
    ],
    mood: [
        ['Melancholia', {
            primary: {temperature: -20, saturation: -40, exposure: -0.15, contrast: -5, outputBlack: 5},
            wheels: {shadows: [-1, 1, 4], midtones: [-1, 1, 2]},
            vignette: {amount: -25}
        }],
        ['Dreamcore', {
            primary: {exposure: 0.3, tint: 12, saturation: -10, hue: 8, outputBlack: 10},
            diffuse: {amount: 55, radius: 22},
            halation: {amount: 25, threshold: 62, radius: 20, color: '#ffc0e0'},
            rgbSpectrum: {amount: 12},
            grain: {amount: 10}
        }],
        ['Nostalgia', {
            primary: {temperature: 15, saturation: -15, outputBlack: 8},
            filmLut: {stock: 'print', amount: 50},
            diffuse: {amount: 20, radius: 14},
            grain: {amount: 20},
            vignette: {amount: -30}
        }],
        ['Cold Case', {
            primary: {temperature: -30, tint: -15, saturation: -35, contrast: 15},
            filmLut: {stock: 'bleach', amount: 30},
            grain: {amount: 15},
            vignette: {amount: -30}
        }],
        ['War Desat', {
            primary: {saturation: -60, contrast: 35, temperature: 5, blacks: -10},
            filmLut: {stock: 'bleach', amount: 60},
            grain: {amount: 30},
            sharpen: {amount: 25}
        }],
        ['Wasteland', {
            primary: {temperature: 35, tint: -10, saturation: -20, contrast: 25},
            wheels: {shadows: [2, 2, -4], highlights: [6, 4, -6]},
            diffuse: {amount: 20, radius: 16},
            grain: {amount: 20}
        }],
        ['Fairy Tale', {
            primary: {exposure: 0.2, vibrance: 25, tint: 8},
            wheels: {shadows: [2, 0, 5], highlights: [4, 3, 1]},
            diffuse: {amount: 40, radius: 18},
            halation: {amount: 20, threshold: 65, radius: 18, color: '#fff0c0'}
        }],
        ['Soft Romance', {
            primary: {temperature: 12, tint: 10, exposure: 0.2, contrast: -15, saturation: -5},
            wheels: {highlights: [5, 1, 2]},
            diffuse: {amount: 40, radius: 18}
        }],
        ['Thriller Green', {
            primary: {tint: -30, temperature: -5, saturation: -25, contrast: 25},
            wheels: {shadows: [-2, 3, 1], midtones: [-1, 3, 0]},
            filmLut: {stock: 'cine', amount: 30},
            vignette: {amount: -35}
        }],
        ['Space Opera', {
            primary: {contrast: 30, temperature: -10, saturation: 10, blacks: -15},
            mojo: {amount: 60, protect: 70},
            halation: {amount: 30, threshold: 60, radius: 20, color: '#60a0ff'},
            lensDistortion: {amount: -10},
            vignette: {amount: -30}
        }]
    ],
    mono: [
        ['Ansel B&W', {
            primary: {saturation: -100, contrast: 30, highlights: -20, shadows: 20, whites: 15, blacks: -20},
            mixer: {red: [120, -10, -10], green: [0, 100, 0], blue: [-10, 0, 60]},
            sharpen: {amount: 30}
        }],
        ['High-Key', {
            primary: {saturation: -100,
                exposure: 0.6,
                contrast: -10,
                highlights: 20,
                whites: 30,
                blacks: 20,
                outputBlack: 10},
            diffuse: {amount: 20, radius: 14}
        }],
        ['Low-Key Noir', {
            primary: {saturation: -100, exposure: -0.5, contrast: 50, blacks: -30},
            grain: {amount: 25},
            vignette: {amount: -55}
        }],
        ['Coffee Sepia', {
            primary: {contrast: 10},
            colorRemap: {shadow: '#1e120a', mid: '#6e4a30', highlight: '#e9d4b8', amount: 100},
            grain: {amount: 15}
        }],
        ['Cyanotype', {
            primary: {contrast: 15},
            colorRemap: {shadow: '#0b1f3f', mid: '#2f6c9e', highlight: '#e6f1f7', amount: 100}
        }],
        ['Selenium', {
            primary: {contrast: 20},
            colorRemap: {shadow: '#1a1216', mid: '#6d5d66', highlight: '#f1ece8', amount: 100},
            grain: {amount: 15}
        }],
        ['Copper Duo', {
            primary: {contrast: 15},
            duotone: {dark: '#2a1408', light: '#f3b27a', amount: 100}
        }],
        ['Teal Duo', {
            primary: {contrast: 10},
            duotone: {dark: '#0c2a30', light: '#bff0e6', amount: 100}
        }],
        ['Crimson Mono', {
            primary: {contrast: 20},
            duotone: {dark: '#200308', light: '#ffb0b0', amount: 100}
        }]
    ]
};

const PRESETS = [];
for (const category of CATEGORIES) {
    for (const [name, settings] of definitions[category.id]) {
        PRESETS.push(Object.freeze(Object.assign({id: presetId(name), name, category: category.id}, settings)));
    }
}

const PRESETS_BY_ID = new Map(PRESETS.map(preset => [preset.id, preset]));
const PRESETS_BY_NAME = new Map(PRESETS.map(preset => [preset.name.toLowerCase(), preset]));

// Block arguments may come from reporters, so accept either the stored id or the displayed name.
const findPreset = value => {
    const key = String(typeof value === 'undefined' || value === null ? '' : value).trim();
    return PRESETS_BY_ID.get(key) || PRESETS_BY_NAME.get(key.toLowerCase()) || PRESETS_BY_ID.get(presetId(key)) ||
        null;
};

export {CATEGORIES, PRESETS, findPreset, presetId};
