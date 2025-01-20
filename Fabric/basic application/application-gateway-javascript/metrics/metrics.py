import re
from collections import defaultdict
import pandas as pd
import matplotlib.pyplot as plt

if __name__ == "__main__":
    with open(r'time.txt', "r") as file:
        capture_groups = [re.match(r"(?P<action>\w*) STAMP\(.*\): (?P<time>\d*\.\d*)(?P<unit>\w+)", line) for line in file]
        d = defaultdict(list)
        for group in capture_groups:
            if not group == None:
                if (group.group(3) == 's'):
                    d[group.group(1)].append(float(group.group(2)))
                else: # milliseconds -> seconds
                    d[group.group(1)].append(float(group.group(2)) / 1000)
        descriptions = []
        for k in d:
            df = pd.DataFrame(d[k], columns=[k]).describe()
            print(df)
            descriptions.append(df)
        merged = pd.concat(descriptions, axis=1).drop(["count", "std"], axis=0)
        transposed = merged.T

        # Graph erstellen
        transposed.plot(kind='bar', figsize=(12, 6), width=0.8)
        plt.xlabel("Funktionsaufrufe", fontsize=16)
        plt.ylabel("Milisekunden", fontsize=16)
        plt.xticks(rotation=45, fontsize=16)
        plt.grid(axis='y', linestyle='--', alpha=0.7)

        # Speichern
        plt.tight_layout()
        plt.savefig("statistik_bar.png", dpi=300)

        

