import re


def review_text(text: str) -> str:
    """Review and clean text for grammar, spacing, and formatting issues.

    Applies common corrections before generating the final document:
    - Remove multiple consecutive spaces
    - Fix spacing after punctuation marks
    - Fix spacing before punctuation marks
    - Normalize line breaks
    - Fix common capitalization after periods
    - Remove leading/trailing whitespace
    """
    if not text or not text.strip():
        return text

    # Normalize line breaks
    result = text.replace("\r\n", "\n").replace("\r", "\n")

    # Remove multiple consecutive spaces (but preserve newlines)
    result = re.sub(r"[^\S\n]+", " ", result)

    # Remove spaces before punctuation marks (.,;:!?)
    result = re.sub(r"\s+([.,;:!?])", r"\1", result)

    # Ensure space after punctuation marks when followed by a letter
    result = re.sub(r"([.,;:!?])([A-Za-záéíóúÁÉÍÓÚñÑüÜ])", r"\1 \2", result)

    # Fix multiple punctuation (e.g., ".." -> ".")
    result = re.sub(r"\.{2,}", ".", result)
    result = re.sub(r",{2,}", ",", result)

    # Capitalize first letter after period + space
    def capitalize_after_period(match):
        return match.group(1) + match.group(2).upper()

    result = re.sub(r"(\.\s+)([a-záéíóúñü])", capitalize_after_period, result)

    # Fix opening parenthesis spacing: remove space after (
    result = re.sub(r"\(\s+", "(", result)
    # Fix closing parenthesis spacing: remove space before )
    result = re.sub(r"\s+\)", ")", result)

    # Remove trailing spaces on each line
    result = "\n".join(line.rstrip() for line in result.split("\n"))

    # Trim overall
    result = result.strip()

    return result


def review_field_values(field_values: dict) -> dict:
    """Apply text review to all string field values in a dictionary."""
    reviewed = {}
    for key, value in field_values.items():
        if isinstance(value, str):
            reviewed[key] = review_text(value)
        else:
            reviewed[key] = value
    return reviewed
