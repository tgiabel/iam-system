import os
import subprocess
import unittest
from pathlib import Path


class ResourceIdentifierTests(unittest.TestCase):
    def test_identifier_in_node(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/resource_identifier_checks.js'],
                                cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
