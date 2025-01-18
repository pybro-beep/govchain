import re
from collections import defaultdict
import pandas as pd

if __name__ == "__main__":
    with open(r'V:\_GH\govchain\Fabric\basic application\application-gateway-javascript\metrics\time.txt', "r") as file:
        capture_groups = [re.match(r"(?P<action>\w*) STAMP\(.*\): (?P<time>\d*\.\d*)(?P<unit>\w+)", line) for line in file]
        d = defaultdict(list)
        for group in capture_groups:
            if not group == None:
                if (group.group(3) == 's'):
                    d[group.group(1)].append(float(group.group(2)))
                else: # milliseconds -> seconds
                    d[group.group(1)].append(float(group.group(2)) / 1000)
        for k in d:
            print(pd.DataFrame(d[k], columns=[k]).describe())
        

