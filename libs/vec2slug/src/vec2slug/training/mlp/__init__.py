"""MLP bag-of-tokens slug predictor (Variant 1).

Three ordering sub-variants for arranging predicted tokens into a slug:
  1a (score):    sort by descending sigmoid score
  1b (position): sort by position head's predicted position
  1c (pairwise): learned pairwise ordering from training co-occurrences
"""
