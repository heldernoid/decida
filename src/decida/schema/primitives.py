from enum import Enum


class Primitive(str, Enum):
    CHOICE = "choice"
    SCORE = "score"
    NOUL = "noul"
