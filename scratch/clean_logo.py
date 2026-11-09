import cv2
import numpy as np

img_path = 'public/assets/ui/logo_santa_delivery_clean.png'
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)

if img is not None and img.shape[2] == 4:
    alpha = img[:, :, 3]
    # Threshold alpha to get binary mask of non-transparent pixels
    _, thresh = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(thresh)
    
    # Find the largest component (excluding background at index 0)
    # The main logo will have by far the largest area
    areas = stats[1:, cv2.CC_STAT_AREA]
    max_idx = np.argmax(areas) + 1
    
    # We keep components that are either the main logo or at least 2% of the main logo's size
    # and sufficiently close to the center
    main_area = stats[max_idx, cv2.CC_STAT_AREA]
    keep_mask = np.zeros_like(alpha)
    
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        # If component is very small (< 1000 pixels) or floating away, remove it
        if area > 1200 or area == main_area:
            keep_mask[labels == i] = 255
            
    # Apply keep_mask to alpha channel
    img[:, :, 3] = cv2.bitwise_and(alpha, keep_mask)
    
    # Also trim any transparent border
    coords = cv2.findNonZero(img[:, :, 3])
    x, y, w, h = cv2.boundingRect(coords)
    pad = 8
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(img.shape[1], x + w + pad)
    y1 = min(img.shape[0], y + h + pad)
    
    cropped = img[y0:y1, x0:x1]
    cv2.imwrite('public/assets/ui/logo_santa_delivery_clean.png', cropped)
    print(f"Cleaned logo saved: {cropped.shape[1]}x{cropped.shape[0]}")
else:
    print("Failed to load image")
