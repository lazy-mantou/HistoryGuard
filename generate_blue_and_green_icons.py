import os
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

def create_shield_icon(size=512, mode='blue'):
    """
    mode: 'blue' (平时普通状态) or 'green' (保护状态) or 'dim' (特殊内置页面备用)
    """
    W = 1024
    H = 1024
    
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    
    # 1. Scaled Shield Geometry on 1024x1024
    points = []
    
    # Top curve from center (512, 42) to right shoulder (944, 154)
    for i in range(30):
        t = i / 29.0
        x = (1-t)**2 * 512 + 2*(1-t)*t * 728 + t**2 * 944
        y = (1-t)**2 * 42 + 2*(1-t)*t * 42 + t**2 * 154
        points.append((x, y))
        
    # Right flank from (944, 154) to bottom (512, 970)
    for i in range(1, 60):
        t = i / 59.0
        x = (1-t)**3 * 944 + 3*(1-t)**2*t * 960 + 3*(1-t)*t**2 * 768 + t**3 * 512
        y = (1-t)**3 * 154 + 3*(1-t)**2*t * 560 + 3*(1-t)*t**2 * 855 + t**3 * 970
        points.append((x, y))
        
    # Left flank from bottom (512, 970) to (80, 154)
    for i in range(1, 60):
        t = i / 59.0
        x = (1-t)**3 * 512 + 3*(1-t)**2*t * 256 + 3*(1-t)*t**2 * 64 + t**3 * 80
        y = (1-t)**3 * 970 + 3*(1-t)**2*t * 855 + 3*(1-t)*t**2 * 560 + t**3 * 154
        points.append((x, y))
        
    # Top-left curve from (80, 154) back to (512, 42)
    for i in range(1, 29):
        t = i / 29.0
        x = (1-t)**2 * 80 + 2*(1-t)*t * 296 + t**2 * 512
        y = (1-t)**2 * 154 + 2*(1-t)*t * 42 + t**2 * 42
        points.append((x, y))

    # Soft drop shadow directly beneath shield
    shadow_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh_draw = ImageDraw.Draw(shadow_img)
    offset_pts = [(p[0], p[1] + 16) for p in points]
    sh_draw.polygon(offset_pts, fill=(0, 0, 0, 42))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(16))
    img = Image.alpha_composite(shadow_img, img)

    # Mask and fill for shield
    shield_mask = Image.new('L', (W, H), 0)
    s_draw = ImageDraw.Draw(shield_mask)
    s_draw.polygon(points, fill=255)
    
    shield_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh_grad_draw = ImageDraw.Draw(shield_img)
    
    y_min = 42
    y_max = 970
    
    for y in range(int(y_min), int(y_max) + 1):
        t = (y - y_min) / float(y_max - y_min)
        if mode == 'blue':
            # 平时蓝色: Vibrant Google Tech Blue to Cyan Blue
            # Top: #3b82f6 (59, 130, 246) -> Bottom: #0284c7 (2, 132, 199)
            r = int(59 * (1 - t) + 2 * t)
            g = int(130 * (1 - t) + 132 * t)
            b = int(246 * (1 - t) + 199 * t)
        elif mode == 'green':
            # 保护状态绿色: Emerald Green to Electric Cyan
            # Top: #10b981 (16, 185, 129) -> Bottom: #059669 (5, 150, 105)
            r = int(16 * (1 - t) + 5 * t)
            g = int(185 * (1 - t) + 150 * t)
            b = int(129 * (1 - t) + 105 * t)
        else: # 'dim'
            # 待机/内置灰色
            r = int(148 * (1 - t) + 100 * t)
            g = int(163 * (1 - t) + 116 * t)
            b = int(184 * (1 - t) + 139 * t)
        sh_grad_draw.line([(0, y), (W, y)], fill=(r, g, b, 255))
        
    img.paste(shield_img, (0, 0), shield_mask)
    
    # Crisp edge outline
    draw = ImageDraw.Draw(img)
    if mode == 'blue':
        edge_color = (29, 78, 216, 200) # Deep blue
    elif mode == 'green':
        edge_color = (4, 120, 87, 200)  # Deep emerald
    else:
        edge_color = (71, 85, 105, 180)
    draw.polygon(points, outline=edge_color, width=8)

    # 2. Render Chrome History Icon using PyMuPDF vector path onto transparent 1024x1024
    hist_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512, 480) scale(26.5) translate(-13, -12)">
    <path fill="#ffffff" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
  </g>
</svg>'''
    doc = pymupdf.open(stream=hist_svg.encode('utf-8'), filetype="svg")
    pix = doc[0].get_pixmap(alpha=True)
    hist_img = Image.frombytes("RGBA", [pix.width, pix.height], pix.samples)
    doc.close()

    # Composite white history icon onto shield
    img = Image.alpha_composite(img, hist_img)
    
    # Downscale using Lanczos for razor-sharp edges
    res = img.resize((size, size), Image.Resampling.LANCZOS)
    return res

if __name__ == '__main__':
    icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(icons_dir, exist_ok=True)
    
    sizes = [16, 32, 48, 128, 512]
    
    # 1. Generate blue icons (平时蓝色)
    print("Generating blue icons (Normal)...")
    for s in sizes:
        img = create_shield_icon(s, mode='blue')
        img.save(os.path.join(icons_dir, f"icon{s}.png"))
        print(f"  -> icon{s}.png")
        
    # 2. Generate green icons (保护状态绿色)
    print("Generating green icons (Protected)...")
    for s in sizes:
        img = create_shield_icon(s, mode='green')
        img.save(os.path.join(icons_dir, f"icon-green{s}.png"))
        print(f"  -> icon-green{s}.png")
        
    # 3. Generate dim icons (备用灰度)
    print("Generating dim icons...")
    for s in sizes:
        img = create_shield_icon(s, mode='dim')
        img.save(os.path.join(icons_dir, f"icon-dim{s}.png"))
        print(f"  -> icon-dim{s}.png")
        
    print("\nAll icons successfully generated in icons/ directory!")
