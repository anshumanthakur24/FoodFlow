import os
import shutil
import gdown

folder_url = "https://drive.google.com/drive/folders/1gQwjKeqUemDCtn98AmEA7qCry-lC9Rvd?usp=sharing"
output_folder = "./crop-generation-data"

if not os.path.exists(output_folder):
    os.makedirs(output_folder)
    print(f"Created folder: {output_folder}")

pre_existing = set(os.listdir(output_folder))

print("Starting download from Google Drive folder...")
print("This may take a moment as it zips the files on Google's end.")

try:
    gdown.download_folder(url=folder_url, output=output_folder, quiet=False, use_cookies=False)

    post_items = set(os.listdir(output_folder))
    new_items = post_items - pre_existing

    for item in new_items:
        item_path = os.path.join(output_folder, item)
        if os.path.isdir(item_path):
            for inner in os.listdir(item_path):
                src = os.path.join(item_path, inner)
                dest = os.path.join(output_folder, inner)
                if os.path.exists(dest):
                    print(f"Skipped moving {src} because {dest} already exists.")
                    continue
                shutil.move(src, dest)
            if not os.listdir(item_path):
                os.rmdir(item_path)

    print("\n-------------------")
    print("Download complete!")
    print(f"Files are saved in: {os.path.abspath(output_folder)}")
    print("-------------------")

except Exception as e:
    print("\nAn error occurred during download:")
    print(e)
    print("Please check the URL and your internet connection.")
