import re
from collections import defaultdict
import pandas as pd
import matplotlib as plt

if __name__ == "__main__":
    # use regex with list comprehension to get time data
    # with open(f'{os.getcwd()}Fabric\\basic application\\application-gateway-javascript\\metrics\\time.txt', "r") as file:
    with open(r'V:\_GH\govchain\Fabric\basic application\application-gateway-javascript\metrics\time.txt', "r") as file:
        capture_groups = [re.match(r"(?P<action>\w*) STAMP\(.*\): (?P<time>\d*\.\d*)(?P<unit>\w+)", line) for line in file]
        d = defaultdict(list)
        for group in capture_groups:
            if not group == None:
                d[group.group(1)].append((float(group.group(2)), str(group.group(3))))
        for k in d:
            print(pd.DataFrame(d[k], columns=[k, "unit"]).median(numeric_only=True))
        

