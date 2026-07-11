#!/usr/bin/env python3
import argparse
from huggingface_hub import snapshot_download


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--target", required=True)
    args = parser.parse_args()
    snapshot_download(
        repo_id=args.model,
        revision=args.revision,
        local_dir=args.target,
        local_dir_use_symlinks=False,
        allow_patterns=[
            "*.json",
            "*.safetensors",
            "*.model",
            "*.txt",
            "*.py",
            "preprocessor_config.json",
            "processor_config.json",
            "tokenizer.*",
            "vocab.*",
            "merges.txt",
        ],
    )
    print(f"downloaded {args.model}@{args.revision} to {args.target}")


if __name__ == "__main__":
    main()
