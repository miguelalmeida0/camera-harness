import os
import re


def main():
    phase = "imports"
    try:
        import builtins
        import torch
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        from transformers import AutoModelForImageTextToText, AutoProcessor
        builtins.Image = Image
        builtins.ImageDraw = ImageDraw
        builtins.ImageFont = ImageFont
        builtins.ImageOps = ImageOps
    except Exception:
        print("REAL_SPATIAL_MODEL_UNAVAILABLE")
        return
    try:
        phase = "source"
        source = _model_source()
        if not source:
            print("REAL_SPATIAL_MODEL_UNAVAILABLE")
            return
        phase = "processor_load"
        processor = AutoProcessor.from_pretrained(source, local_files_only=True)
        phase = "model_load"
        model = AutoModelForImageTextToText.from_pretrained(source, local_files_only=True, torch_dtype=torch.float32, low_cpu_mem_usage=True)
        model.eval()
        first = _scene(20)
        second = _scene(48)
        prompt = "Compare the two ordered images. Return JSON only: {\"object_visible\":true,\"movement\":\"left|right|stationary\"}."
        content = [{"type": "text", "text": prompt}, {"type": "image", "image": first}, {"type": "image", "image": second}]
        inputs = processor.apply_chat_template([{"role": "user", "content": content}], add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt")
        phase = "generation"
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=64, do_sample=False)
        decoded = processor.batch_decode(generated[:, inputs["input_ids"].shape[-1]:], skip_special_tokens=True)[0].strip()
        first.close()
        second.close()
        print("REAL_SPATIAL_MODEL_PASS" if decoded else "REAL_SPATIAL_MODEL_FAILED")
    except Exception as error:
        if os.getenv("SPATIAL_SMOKE_DEBUG") == "1":
            print(f"SPATIAL_SMOKE_DEBUG:{phase}:{type(error).__name__}")
            print(re.sub(r"[^a-zA-Z0-9_ .:-]", "", str(error))[:160])
        print("REAL_SPATIAL_MODEL_FAILED")


def _scene(x):
    image = Image.new("RGB", (128, 96), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((x, 32, x + 24, 64), fill="red")
    draw.rectangle((88, 30, 112, 66), fill="blue")
    return image


def _model_source():
    candidates = [
        os.path.abspath(".models/visual-companion/smolvlm2-2.2b-instruct"),
        os.path.abspath("../camera-harness/.models/visual-companion/smolvlm2-2.2b-instruct"),
        "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
    ]
    for candidate in candidates[:2]:
        if os.path.exists(os.path.join(candidate, "config.json")):
            return candidate
    return candidates[-1]


if __name__ == "__main__":
    main()
